# Rocket Relay Canvas

A no-login team drawing game for anniversary events. Players open the same link, enter a name, and take turns adding one stroke to a shared 600x400 canvas.

Realtime sync is powered by Liveblocks, so the app can be hosted as a static site.

## Run locally

```sh
node server.js
```

Then open:

```text
http://localhost:4173
```

For a rehearsal on one laptop, open the page in multiple tabs and join with different names. The first player to join is the host and gets Undo and Clear all.

## Public hosting

This repo can be hosted on GitHub Pages from the `main` branch root.

Team links can use separate rooms:

```text
https://marusevich.github.io/rocket-relay-canvas/?room=team-1
```

## Notes

- Players are live presence, so the visible player list is based on who is currently connected.
- Strokes are stored in the Liveblocks room until the host clears the canvas.
- Use a different `?room=` value for each team.
