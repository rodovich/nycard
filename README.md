# New Year's card designer

A single-page app for laying out a two-sided 5×7 flat card to upload to Paper Culture as your own design.

Run `node dev-server.js` and open http://localhost:5173. There are no dependencies to install.

Editing any file reloads the app (CSS is swapped without a reload). The design is saved in browser storage, so it survives reloads.

The download button saves `new-years-card-front.jpg` and `new-years-card-back.jpg`. Each is 5.25×7.125 in at 400 dpi (2100×2850 px, or 2850×2100 px for landscape). That is the design size Paper Culture's 5X7FLAT DIY template gives for a card that trims to 5.125×7.0 in. The print specs are in `src/specs.js`.
