/**
 * HAND-WRITTEN STUB -- not a copy of the repo's keyboard.js. Never synced.
 *
 * The real PikaKeyboard attaches DOM listeners, which do not exist in Node.
 * pikavolley.js constructs two of these in its constructor; the harness then
 * replaces both slots with real input sources before the match starts, so
 * these instances only ever have to exist and report "no key pressed".
 *
 * getInput() zeroing the three fields is what a real keyboard with nothing
 * held down does, and it matters: round() reads keyboardArray[i].powerHit at
 * the top of every frame.
 */
'use strict';
import { PikaUserInput } from './physics.js';

export class PikaKeyboard extends PikaUserInput {
  getInput() {
    this.xDirection = 0;
    this.yDirection = 0;
    this.powerHit = 0;
  }
  unsubscribe() {}
}
