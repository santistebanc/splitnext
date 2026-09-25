# Generate invite tokens on clients and store only hashes

The client that creates a group's invite link generates its 256-bit token and
an invite id, sends both, and keeps the plaintext locally. The Worker hashes the
token before calling the group's Durable Object, which stores only the hash, so
neither storage nor the group snapshot can reveal a working link. Because the
client chose the token, a creation retried after a lost response returns the
same link instead of rotating it, matching how device secrets already work.

The consequence is that only the creating device can show a link again. Other
participants see its creator and expiry and can replace it, which revokes it.
Links take the form `/join/{groupId}#{token}` so browsers never send the token
to a server or include it in referrers, and previews send it in a request body
rather than a URL.
