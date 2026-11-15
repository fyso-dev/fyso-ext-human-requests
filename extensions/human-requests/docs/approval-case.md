# Example: review a proposed extension installation

This is a **test-only scenario** for evaluating the human request flow. It does not install an extension or authorize a real installation. Requests are visible to project panel operators; the intended recipient and self-declared responder do not enforce or prove individual identity.

1. **Who and when:** a project agent proposes an extension and needs a person's decision before preparing a review. The agent names itself and links or describes the originating task in the request.
2. **Recipient:** a named project participant or the team, as specified by the person who assigned the work. If the intended recipient is unknown, the agent asks the requester or addresses the team; it does not invent a name.
3. **Context:** the request identifies the extension and source, why it was proposed, what would happen after each answer and that this is a test. The proposed answers are `Approve review` and `Decline`. Approval allows a later review step only; it is not permission to install. Declining stops the proposal. No answer leaves the proposal waiting until its declared expiry, if any.
4. **Discovery:** the panel shows a counter beside Pending in its menu and a notice in its top bar on every screen, highlighted when a request holds up work. No notification outside the panel is promised by this version.
5. **Questions first:** from the request, the person may ask the agent a question. The agent answers in the originating task without acting, and the request stays open with the question and the reply.
6. **Continuation:** the agent reads the recorded answer in the originating task and prepares the corresponding review or stops. Cancellation stops the proposal; expiry is reported as unanswered. A saved answer, successful delivery step and completed agent work are separate states. The user checks the history if delivery fails.

Do not use the current flow for sensitive approvals: a label is only a routing hint, the responder name is self-declared, and panel access grants trusted operator capabilities. Automatic retries deduplicate the message using OpenMausBot's native identifier, but do not guarantee exactly-once external effects. Apply real changes only through the project's normal review and authorization flow.
