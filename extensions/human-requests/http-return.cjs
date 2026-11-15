// Experimental HTTP transport. Configuration is supplied by a trusted caller;
// this module does not read project files, secrets, or user-controlled URLs itself.
const {createHash} = require('node:crypto');
const {lookup} = require('node:dns/promises');
const https = require('node:https');
const net = require('node:net');

const blocked = new net.BlockList();
for (const [ip, bits] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8],
  ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24],
  ['192.0.2.0',24], ['192.88.99.0',24], ['192.168.0.0',16],
  ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24],
  ['224.0.0.0',4], ['240.0.0.0',4],
]) blocked.addSubnet(ip,bits,'ipv4');
for (const [ip,bits] of [['2001::',23], ['2001:db8::',32], ['2002::',16]]) blocked.addSubnet(ip,bits,'ipv6');
const globalV6 = new net.BlockList();
globalV6.addSubnet('2000::',3,'ipv6');
const privateV4 = new net.BlockList();
for (const [ip,bits] of [['10.0.0.0',8],['100.64.0.0',10],['172.16.0.0',12],['192.168.0.0',16]]) privateV4.addSubnet(ip,bits,'ipv4');
const privateV6 = new net.BlockList();
privateV6.addSubnet('fc00::',7,'ipv6');
const metadataV6 = new net.BlockList();
metadataV6.addSubnet('fd00:ec2::',32,'ipv6');

function normalizedAddress(input) {
  if (typeof input !== 'string' || input !== input.trim()) throw Error('Invalid private HTTP address');
  const family=net.isIP(input);
  if (!family) throw Error('Invalid private HTTP address');
  // URL normalizes equivalent IPv6 spelling; IP literals in URL.hostname have
  // brackets, while DNS lookup returns them without brackets.
  const address = family===6 ? new URL(`https://[${input}]/`).hostname.slice(1,-1) : input;
  return {address,family};
}

function configuredPrivateAddress(input) {
  if (!input) return null;
  const address=normalizedAddress(input);
  const approved=address.family===4
    ? (address.address==='127.0.0.1' || (privateV4.check(address.address,'ipv4') && address.address!=='100.100.100.200'))
    : (address.address==='::1' || (privateV6.check(address.address,'ipv6') && !metadataV6.check(address.address,'ipv6')));
  // This allows only explicit loopback, RFC1918, CGNAT and IPv6 ULA. It never
  // allows link-local, unspecified, multicast, mapped IPv4 or cloud metadata.
  if (!approved) throw Error('Invalid private HTTP address');
  return address;
}

function publicAddress(address, family) {
  const kind = family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : '';
  if (!kind || net.isIP(address) !== family) return false;
  return !blocked.check(address, kind) && (family === 4 || globalV6.check(address,'ipv6'));
}

function safeUrl(raw, privateAddress = null) {
  if (typeof raw !== 'string' || raw.length > 2048) throw Error('Invalid HTTP destination');
  let url; try { url = new URL(raw); } catch { throw Error('Invalid HTTP destination'); }
  const host = url.hostname.replace(/^\[|\]$/g,'');
  // Credentials, query strings and fragments are excluded. An IP literal is
  // accepted only when it equals the explicitly configured private address.
  const family=net.isIP(host);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || host.endsWith('.') ||
      (family ? (!privateAddress || normalizedAddress(host).address!==privateAddress.address) : (!host.includes('.') && !(privateAddress && host==='localhost')))) throw Error('Invalid HTTP destination');
  return url;
}

async function deliverHttp({destination, allowlist, bearer, project, runId, payload, privateAddress:privateAddressRaw}, dependencies = {}) {
  if (!Array.isArray(allowlist) || allowlist.length < 1 || allowlist.length > 32) throw Error('HTTP destinations are not configured');
  const privateAddress=configuredPrivateAddress(privateAddressRaw);
  const target = safeUrl(destination,privateAddress);
  // Canonical exact URL comparison includes scheme, host, port and path.
  if (!allowlist.some(entry => { try { return safeUrl(entry,privateAddress).href === target.href; } catch { return false; } })) throw Error('HTTP destination is not allowed');
  if (typeof bearer !== 'string' || !bearer || bearer.length > 4096 || /[\r\n\x00-\x1f\x7f]/.test(bearer)) throw Error('HTTP credential is not configured');
  if (typeof project !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(project) || typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) throw Error('Stable request identity is required');
  const body = JSON.stringify(payload);
  if (typeof body !== 'string' || Buffer.byteLength(body) > 65536) throw Error('Invalid HTTP payload');
  const idempotencyKey = 'fyso-hr-' + createHash('sha256').update(JSON.stringify([project,runId])).digest('hex');

  // Refuse the entire DNS answer if any address is non-public. Pin one vetted
  // address to the actual TLS connection, avoiding DNS re-resolution/rebinding.
  let answers;
  let dnsTimer;
  try {
    const host=target.hostname.replace(/^\[|\]$/g,''),family=net.isIP(host);
    answers = await Promise.race([
      family ? Promise.resolve([normalizedAddress(host)]) : (dependencies.lookup || lookup)(target.hostname, {all:true, verbatim:true}),
      new Promise((_,reject) => { dnsTimer=setTimeout(() => reject(Error('timeout')),5000); dnsTimer.unref(); }),
    ]);
  } catch { throw Error('HTTP destination lookup failed'); }
  finally { clearTimeout(dnsTimer); }
  if (!Array.isArray(answers) || answers.length === 0 || answers.some(item => {
    if (!item || net.isIP(item.address)!==item.family) return true;
    if (!privateAddress) return !publicAddress(item.address,item.family);
    try { const address=normalizedAddress(item.address);return address.family!==privateAddress.family || address.address!==privateAddress.address; } catch { return true; }
  })) throw Error(privateAddress ? 'HTTP destination address does not match configured private address' : 'HTTP destination address is not public');
  const selected = answers[0];
  const request = dependencies.request || https.request;
  return new Promise((resolve,reject) => {
    let settled = false;
    let deadline;
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(deadline); error ? reject(Error(error)) : resolve({delivered:true,idempotencyKey}); };
    let req;
    try {
      req = request(target, {
        method:'POST', timeout:10000, family:selected.family, autoSelectFamily:false,
        lookup: (_host, opts, callback) => opts?.all ? callback(null,[selected]) : callback(null,selected.address,selected.family),
        headers: {'content-type':'application/json','content-length':Buffer.byteLength(body), authorization:`Bearer ${bearer}`, 'idempotency-key':idempotencyKey},
      }, response => {
        // Node does not follow redirects. Never buffer or log response data.
        response.on('error', () => {});
        response.destroy();
        if (response.statusCode >= 200 && response.statusCode < 300 && response.headers['idempotency-key'] === idempotencyKey) finish();
        else finish('HTTP delivery was not acknowledged');
      });
      req.on('timeout', () => { req.destroy(); finish('HTTP delivery timed out; result is uncertain'); });
      req.on('error', () => finish('HTTP delivery failed; result may be uncertain'));
      deadline = setTimeout(() => { req.destroy(); finish('HTTP delivery timed out; result is uncertain'); },10000);
      deadline.unref();
      req.end(body);
    } catch { finish('HTTP delivery failed; result may be uncertain'); }
  });
}

module.exports = {deliverHttp, publicAddress, safeUrl, configuredPrivateAddress};
