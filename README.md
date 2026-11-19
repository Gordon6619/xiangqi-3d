# 楚漢 3D 象棋 (Xiangqi 3D)

A 3D Chinese chess game that runs in the browser. Everything it needs is in this folder: no build step, no CDN, no audio files.

## Run it

```bash
node server.mjs          # or: npm start
```

Then open http://localhost:8080. Any static web server works too (for example `python3 -m http.server`). Don't open `index.html` straight from disk with `file://`, because ES modules and Web Workers won't load that way.

## Features

| Requirement | How it's done |
|---|---|
| Single player | Alpha-beta AI with iterative deepening, quiescence search, MVV-LVA, killer moves and history ordering. Runs in a Web Worker, so the page doesn't freeze while it thinks. Four levels: 入門 / 業餘 / 高手 / 大師 |
| Online play | Peer-to-peer WebRTC through PeerJS. The host gets a 6-character room code or an invite link (`?join=CODE`). Moves are checked on both ends. Supports undo requests, resign, new-game requests and resyncing after a desync. Each player's custom army shows on both screens |
| Same-device two player | Pass-and-play. The view flips automatically each turn |
| Mouse and touch | Tap to select then tap to move, or drag and drop. One finger rotates the camera, two fingers pinch to zoom. Keyboard: Esc deselects, U undoes, F flips the view |
| Responsive layout | The camera refits to the screen's aspect ratio. Phones get a bottom drawer, desktops get a side panel. Handles notches and safe areas |
| 3D graphics | three.js with PBR materials (clearcoat lacquer, metal armour, fur bump maps, sheen on fabric), ACES tone mapping, soft shadows and environment lighting |
| Figures follow each character's literal meaning | 帥/將 marshal, 仕 court official with a scroll, 士 strategist with a feather fan, 相 chancellor with a court tablet, 象 war elephant with a mahout, 傌/馬 cavalryman on horseback, 俥 chariot with a standing warrior, 車 horse-drawn chariot, 炮 bronze gunpowder cannon, 砲 stone-throwing catapult, 兵 spearman, 卒 sword-and-shield infantry. No bases: each piece's character is on the figure itself (chest and back, animal flanks, vehicle front and back, banners). Each side can pick between variants that keep the meaning (weapon, horse colour, elephant type) and choose from 3 colour schemes |
| Lifelike poses | Every figure has a skeleton (hips, knees, arms, head, neck, tail, trunk, ears, wheels). While standing, each one breathes, blinks, shifts its weight and plays random actions suited to its role: the marshal inspects his sword and points out orders, the strategist fans himself and strokes his beard, the chancellor bows, soldiers drill with spears and practise sword swings, horses swish their tails, paw the ground and graze, elephants flap their ears, curl and raise their trunks and stomp, the cannon crew wipes the barrel and adjusts the aim, the catapult loader lifts stones. Walking uses a real gait (knee flex, body bob, hip sway, arm swing) with steps matched to the distance travelled, steps on the spot while turning, curved paths for horses, and smooth starts and stops |
| Separate sound for each piece | 帥將: armoured steps and war drum. 仕士: silk rustle and jade chimes. 相象: elephant trumpet and heavy stomps. 傌馬: four-beat hoofbeats and a whinny. 俥車: rolling wheels. 炮砲: creaking wheels and a bronze ring. 兵卒: marching steps |
| Captures with impact | A cinematic close-up, then slow motion. The attacker winds up (with a rising tension sound), then strikes (impact, metal clash, debris bouncing). Cannons fire a cannonball over the screen piece and it explodes. The captured piece gets knocked away and lands in the graveyard beside the board. Sparks, wood chips, smoke, a light flash and camera shake. Check plays a gong |
| Official rules | Palace, river, blocked horse leg (蹩馬腿), blocked elephant eye (塞象眼), cannon screen, flying general (將帥照面), no move to leave yourself in check. A side with no legal moves loses (checkmate or stalemate). Perpetual check loses (長將判負), threefold repetition is a draw, 60 moves without a capture is a draw, and so is a position where neither side has attacking pieces. Moves are recorded in Chinese notation (前/後/中) |

The move generator passes perft for the starting position: depth 1 = 44, depth 2 = 1,920, depth 3 = 79,666, which match the known values.

## Online play: how it connects

By default it uses the free public PeerJS signalling server, `0.peerjs.com`. After the two players are connected, moves travel directly between them. To run your own signalling server:

```bash
npx peer --port 9000
```

Then open the game with `?peerHost=your.host&peerPort=9000&peerSecure=0` (use `peerSecure=1` if the server uses HTTPS).
Some strict corporate or mobile-carrier networks block direct WebRTC connections. If that happens, you need to add a TURN server.

## File layout

```
index.html            UI layout
css/style.css         responsive styles
js/rules.js           rules engine, game-end checks, Chinese notation
js/ai.js, ai-worker.js  AI search
js/models.js          procedural rigged characters, animals, discs, palettes, themes
js/anim.js            pose animation, tweens, particles
js/scene.js           renderer, lighting, board textures, camera fitting, picking
js/audio.js           WebAudio sound synthesis (all sounds generated live)
js/net.js             WebRTC online play
js/main.js            game controller: input, capture choreography, UI
vendor/               three.js r170 and PeerJS 1.5.4, bundled locally
```
