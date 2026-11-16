# Network Diagram

A small web app where each Cyber Hub team records the network it has built on its rack, then shares it as a link.
Live at https://glgoltz.github.io/network-diagram/

- **Build:** `node build.mjs` writes `index.html` from `src/`. Commit both.
- **Saving:** the diagram autosaves in the browser. "Copy share link" puts the whole diagram in the link, which is the
  real save. Nothing is sent to a server, and there are no accounts.
- **Hard rule:** the app ships no rack plan, expected values or answers. Everything shown comes from what the team
  typed. See `DIAGRAM_APP_SPEC.md`, section 2.
- **Layout:** every rack has the same devices, so positions are fixed. Teams add only laptops and virtual machines.

Version 1: drawing, list view, undo, browser save, share links, JSON backup, PNG export, print.
Version 2 (planned): consistency checks, packet trace, instructor comparison.
