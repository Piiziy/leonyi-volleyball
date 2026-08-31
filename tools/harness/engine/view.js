/**
 * HAND-WRITTEN STUB -- not a copy of the repo's view.js. Never synced.
 *
 * pikavolley.js talks to the view on 43 lines. Every one of them is a WRITE:
 * a draw call, or an assignment to `.visible` / `.black`. Nothing is ever read
 * back to decide anything -- the round state machine branches only on
 * frameCounter, frameTotal, scores, gameEnded, roundEnded, slowMotion* and
 * keyboardArray[i].powerHit. So replacing the renderer with no-ops cannot
 * change a single frame of simulation.
 *
 * Re-check that claim if pikavolley.js ever changes:
 *   grep -n 'this\.view\.' src/resources/js/pikavolley.js
 * and confirm every hit is still on the left-hand side of an assignment or is
 * a bare method call.
 */
'use strict';
import { Cloud, Wave, cloudAndWaveEngine } from './cloud_and_wave.js';

const noop = () => {};

/** view.js: GameView holds ten clouds and one wave. */
const NUM_OF_CLOUDS = 10;

class StubContainer {
  constructor() {
    this.visible = false;
    this.children = [];
  }
}

export class IntroView {
  constructor() {
    this.container = new StubContainer();
    this.visible = false;
  }
  drawMark = noop;
}

export class MenuView {
  constructor() {
    this.container = new StubContainer();
    this.visible = false;
  }
  selectWithWho = noop;
  drawFightMessage = noop;
  drawPengsooMenuBackground = noop;
  drawSachisoft = noop;
  drawSittingPikachuTiles = noop;
  drawPikachuVolleyballMessage = noop;
  drawPokemonMessage = noop;
  drawWithWhoMessages = noop;
}

export class GameView {
  constructor() {
    this.container = new StubContainer();
    this.visible = false;
    // Written by operator/console.js (syncGameEndState) and by isPracticeMode.
    this.messages = { gameEnd: { visible: false } };
    this.scoreBoards = [{ visible: true }, { visible: true }];

    // NOT decoration as far as the simulation is concerned. Cloud and Wave
    // draw from the SAME rand() stream the physics uses (cloud_and_wave.js),
    // so a harness that skipped them would leave the engine reading different
    // random numbers than the browser does: 40 draws here at construction,
    // then 27+ on every drawCloudsAndWave(). Keeping the real model is what
    // makes a seeded harness run reproduce a seeded browser run frame for
    // frame. Nothing is rendered -- only the draws matter.
    this.cloudArray = [];
    for (let i = 0; i < NUM_OF_CLOUDS; i++) {
      this.cloudArray.push(new Cloud());
    }
    this.wave = new Wave();
  }
  drawPlayersAndBall = noop;
  drawCloudsAndWave = () => {
    cloudAndWaveEngine(this.cloudArray, this.wave);
  };
  drawScoresToScoreBoards = noop;
  drawGameStartMessage = noop;
  drawGameEndMessage = noop;
  drawReadyMessage = noop;
  toggleReadyMessage = noop;
}

export class FadeInOut {
  constructor() {
    this.black = new StubContainer();
    this.visible = false;
  }
  setBlackAlphaTo = noop;
  changeBlackAlphaBy = noop;
}
