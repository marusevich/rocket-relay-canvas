# Rocket Relay Canvas

A no-login team drawing game for anniversary events. Players open the same link, enter a name, and take turns adding one stroke to a shared 600x400 canvas.

## Run locally

```sh
node server.js
```

Then open:

```text
http://localhost:4173
```

For a rehearsal on one laptop, open the page in multiple tabs and join with different names. The first player to join is the host and gets Undo and Clear all.

## Notes

- Real-time updates use Server-Sent Events plus small POST actions, so there are no external services or package installs.
- State is stored in memory. Restarting the server clears players and strokes.
- To use this for a fully remote event, deploy the folder to any Node-capable host and share the public URL with a team.
