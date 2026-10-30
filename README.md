# Cryptid Hunt

An online, hidden-clue deduction game for 3-5 friends. Unofficial fan project, not affiliated with or
endorsed by the publishers of Cryptid. Maps and art are original and generated per game.

No build step and no backend: it's a static site. Rooms use WebRTC via [PeerJS](https://peerjs.com)
(MIT, vendored in `vendor/`) and its free public signalling server. The host's browser runs the rules and
sends each player only what they may see.

    npm test     # rule tests
    npm start    # serve locally on :5173

Known limits: the host's tab must stay open (reloading it resumes the game); a technically minded host
could read the clues from their own browser's storage; and strict networks may block peer connections.
