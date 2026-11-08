# New Year's card designer

A single-page app for laying out a two-sided 5×7 flat card to upload to Paper Culture as your own design.

Install Node.js 24 and Git, and use a modern web browser. There are no third-party dependencies to install and no build step.

Clone the repository and start the development server:

```sh
git clone https://github.com/rodovich/nycard.git
cd nycard
node dev-server.js
```

If you already have the project checked out, run `node dev-server.js` from its root directory. Open http://localhost:5173 in your browser. Press Ctrl+C in the terminal to stop the server.

To use a different port, run `PORT=5174 node dev-server.js` and open http://localhost:5174.

Editing any file reloads the app (CSS is swapped without a reload). The design is saved in browser storage, so it survives reloads.

The download button saves `new-years-card-front.jpg` and `new-years-card-back.jpg`. Each is 5.25×7.125 in at 400 dpi (2100×2850 px, or 2850×2100 px for landscape). That is the design size Paper Culture's 5X7FLAT DIY template gives for a card that trims to 5.125×7.0 in. The print specs are in `src/specs.js`.
