# Generate invite tokens on clients and store only hashes

Superseded by [ADR 0015](./0015-share-the-current-invite-through-group-snapshots.md).

The client that creates a group's invite link generates its 256-bit token and
an invite id, sends both, and keeps the plaintext locally. The Worker hashes the
token before calling the group's Durable Object, which stores only the hash, so
neither storage nor the group snapshot can reveal a working link. Because the
client chose the token, a creation retried after a lost response returns the
same link instead of rotating it, matching how device secrets already work.

Group creation includes the initial invite id and token in `POST /groups`.
The Worker hashes the token and the Durable Object atomically persists the
group, creator member, access grant, and initial invite. The SDK retains the
token before the request, so a lost response or reload reuses the same link.
Creation retries compare the initial token hash and return the original public
metadata; they never restore an invite that was subsequently replaced.

The consequence is that only the creating device can show a link again. Other
participants see its creator and can regenerate it. Every group always has a
current link, with no time limit and no standalone revoke operation.
PUT /groups/{groupId}/invite updates this single resource; the client-generated
invite id identifies a retry-safe token replacement, not an independently
manageable invite. Historical token records prevent an old retry from restoring
a superseded link. Such retries return the current link metadata without
changing the revision. Preview uses POST /groups/{groupId}/invite/preview.
Links take the form `/join/{groupId}#{token}` so browsers never send the token
to a server or include it in referrers, and previews send it in a request body
rather than a URL.
