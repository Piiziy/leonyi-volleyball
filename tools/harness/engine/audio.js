/**
 * HAND-WRITTEN STUB -- not a copy of the repo's audio.js. Never synced.
 *
 * pikavolley.js only ever calls .play() / .stop() on these. The sound FLAGS
 * that drive them live on the physics objects (player.sound.*, ball.sound.*)
 * and are cleared by playSoundEffect(); nothing reads them for control flow,
 * so silence changes nothing about the simulation.
 */
'use strict';

const stubSound = () => ({ play: () => {}, stop: () => {}, loop: false });

export class PikaAudio {
  constructor() {
    this.sounds = {
      bgm: stubSound(),
      pipikachu: stubSound(),
      pika: stubSound(),
      chu: stubSound(),
      pi: stubSound(),
      pikachu: stubSound(),
      powerHit: stubSound(),
      ballTouchesGround: stubSound(),
    };
    this.properBGMVolume = 0.2;
    this.properSFXVolume = 0.35;
  }
  adjustVolume = () => {};
  turnBGMVolume = () => {};
  turnSFXVolume = () => {};
}
