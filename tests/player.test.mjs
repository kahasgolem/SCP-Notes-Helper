import test from 'node:test';
import assert from 'node:assert/strict';
import { NotesPlayer, normalizePlaybackRate } from '../public/player.js';

class FakeAudio extends EventTarget {
  constructor({ ready = true } = {}) {
    super();
    this.readyState = ready ? 3 : 0;
    this.duration = ready ? 10482.654421768708 : NaN;
    this.paused = true;
    this.ended = false;
    this.seeking = false;
    this.error = null;
    this.playbackRate = 1;
    this.defaultPlaybackRate = 1;
    this._time = 0;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.seekAttempts = 0;
    this.ignoreSeeks = 0;
    this.playResult = () => Promise.resolve();
  }
  get currentTime() { return this._time; }
  set currentTime(value) {
    this.seekAttempts++;
    if (!this.readyState) throw new DOMException('Not ready', 'InvalidStateError');
    if (this.ignoreSeeks > 0) { this.ignoreSeeks--; return; }
    this._time = value;
    this.seeking = true;
  }
  emit(name) { this.dispatchEvent(new Event(name)); }
  play() {
    this.playCalls++;
    this.paused = false;
    this.ended = false;
    this.emit('play');
    return this.playResult();
  }
  pause() {
    this.pauseCalls++;
    const changed = !this.paused;
    this.paused = true;
    if (changed) this.emit('pause');
  }
  load() {
    this.readyState = 0;
    this.error = null;
    this._time = 0;
    this.seeking = false;
    this.emit('loadstart');
  }
  metadata() {
    this.readyState = 1;
    this.duration = 10482.654421768708;
    this.emit('loadedmetadata');
  }
  finishSeek(value = this._time) {
    this._time = value;
    this.seeking = false;
    this.emit('seeked');
  }
  tick(value) { this._time = value; this.emit('timeupdate'); }
}

const duration = 10482.654421768708;
function setup(options = {}) {
  const audio = new FakeAudio(options);
  const states = [], times = [], errors = [];
  const player = new NotesPlayer(audio, {
    duration, onState: state => states.push(state), onTime: time => times.push(time), onError: message => errors.push(message)
  });
  return { audio, player, states, times, errors };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('beginning, middle, and end seeks stay inside the final recording', () => {
  const { audio, player } = setup();
  for (const [request, expected] of [[-10, 0], [5241.327, 5241.327], [duration + 99, duration], [NaN, 0]]) {
    assert.equal(player.seek(request), expected);
    assert.equal(player.time, expected);
    audio.finishSeek(expected);
    assert.equal(player.pendingSeek, null);
    assert.equal(audio.currentTime, expected);
  }
  assert.equal(audio.playCalls, 0);
});

test('a click starts play synchronously and retains its target until Safari metadata arrives', async () => {
  const { audio, player } = setup({ ready: false });
  player.seek(345.25, { play: true });
  assert.equal(audio.playCalls, 1, 'play is invoked within the original click turn');
  assert.equal(player.pendingSeek, 345.25);
  assert.equal(player.time, 345.25);
  assert.equal(audio.seekAttempts, 0);
  audio.metadata();
  assert.equal(audio.currentTime, 345.25);
  audio.finishSeek();
  await settle();
  assert.equal(player.pendingSeek, null);
  assert.equal(player.playing, true);
});

test('metadata followed by an ignored distant seek is retried on progress', () => {
  const { audio, player } = setup({ ready: false });
  audio.ignoreSeeks = 1;
  player.seek(8000, { play: true });
  audio.metadata();
  assert.equal(audio.currentTime, 0);
  assert.equal(player.pendingSeek, 8000);
  audio.emit('progress');
  assert.equal(audio.currentTime, 8000);
  audio.finishSeek();
  assert.equal(player.pendingSeek, null);
});

test('rapid passage clicks beat a stale seeked event and a stale play rejection', async () => {
  const { audio, player, errors } = setup();
  let rejectFirst;
  audio.playResult = () => new Promise((resolve, reject) => { rejectFirst = reject; });
  player.seek(20, { play: true });
  audio.playResult = () => Promise.resolve();
  player.seek(40, { play: true });
  audio.finishSeek(20);
  assert.equal(player.pendingSeek, 40);
  assert.equal(audio.currentTime, 40, 'the current pending target is re-applied');
  audio.finishSeek(40);
  rejectFirst(new DOMException('Old gesture', 'NotAllowedError'));
  await settle();
  assert.equal(player.time, 40);
  assert.equal(player.playing, true);
  assert.deepEqual(errors, []);
});

test('restoring a saved listening position never autoplays', () => {
  const { audio, player } = setup({ ready: false });
  player.restore(5199.5);
  audio.metadata();
  audio.finishSeek();
  audio.readyState = 3;
  audio.emit('canplay');
  assert.equal(audio.playCalls, 0);
  assert.equal(audio.paused, true);
  assert.equal(player.playing, false);
  assert.equal(player.time, 5199.5);
});

test('a blocked gesture produces a usable Play prompt and does not retry automatically', async () => {
  const { audio, player, errors } = setup();
  audio.playResult = () => Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
  player.seek(12, { play: true });
  audio.finishSeek();
  await settle();
  assert.equal(player.playing, false);
  assert.match(errors[0], /Tap Play/);
  audio.emit('canplay');
  audio.emit('progress');
  assert.equal(audio.playCalls, 1);
  audio.playResult = () => Promise.resolve();
  player.play();
  await settle();
  assert.equal(player.playing, true);
  assert.equal(audio.playCalls, 2);
});

test('pause wins over a play promise that resolves later', async () => {
  const { audio, player } = setup();
  let resolvePlay;
  audio.playResult = () => new Promise(resolve => { resolvePlay = resolve; });
  player.play();
  player.pause();
  resolvePlay();
  await settle();
  assert.equal(player.playing, false);
  assert.equal(audio.paused, true);
});

test('repeat returns to the selected passage without moving to the next passage', () => {
  const { audio, player } = setup();
  player.setRepeat({ start: 10, end: 20 });
  player.seek(10, { play: true });
  audio.finishSeek();
  audio.tick(20.05);
  assert.equal(player.pendingSeek, 10);
  assert.equal(audio.currentTime, 10);
  assert.equal(audio.playCalls, 2);
  audio.finishSeek();
  player.setRepeat(null);
  audio.tick(25);
  assert.equal(player.time, 25);
});

test('persistent seek failures stop after a bounded number of readiness events', async () => {
  const { audio, player, errors } = setup();
  audio.ignoreSeeks = 100;
  player.seek(9999, { play: true });
  for (let i = 0; i < 50; i++) audio.emit('progress');
  await settle();
  assert.equal(audio.seekAttempts, 12);
  assert.equal(errors.length, 1);
  assert.equal(player.playing, false);
  audio.ignoreSeeks = 0;
  player.play();
  audio.finishSeek();
  await settle();
  assert.equal(player.time, 9999);
  assert.equal(player.pendingSeek, null);
});

test('download progress does not restart a valid in-flight seek', () => {
  const { audio, player, errors } = setup();
  player.seek(9000, { play: true });
  for (let i = 0; i < 50; i++) audio.emit('progress');
  assert.equal(audio.seekAttempts, 1);
  assert.equal(player.pendingSeek, 9000);
  assert.deepEqual(errors, []);
  audio.finishSeek();
  assert.equal(player.pendingSeek, null);
});

test('repeat survives the native pause-then-ended sequence at the recording boundary', async () => {
  const { audio, player } = setup();
  player.setRepeat({ start: duration - 8, end: duration });
  player.play();
  await settle();
  audio._time = duration;
  audio.ended = true;
  audio.pause();
  audio.emit('ended');
  assert.equal(player.pendingSeek, duration - 8);
  assert.equal(audio.currentTime, duration - 8);
  assert.equal(audio.playCalls, 2);
});

test('a media error stops playback and a user retry preserves the requested passage', async () => {
  const { audio, player, errors } = setup();
  player.seek(4321, { play: true });
  audio.finishSeek();
  await settle();
  audio.error = { code: 2 };
  audio.emit('error');
  assert.equal(player.playing, false);
  assert.equal(audio.paused, true);
  assert.match(errors[0], /could not load/);
  player.play();
  assert.equal(player.pendingSeek, 4321);
  assert.equal(audio.readyState, 0);
  audio.metadata();
  audio.finishSeek();
  await settle();
  assert.equal(player.time, 4321);
  assert.equal(player.playing, true);
});

test('playback rate is validated and survives metadata changes', () => {
  const { audio, player } = setup();
  assert.equal(player.setRate(1.5), 1.5);
  audio.playbackRate = 1;
  audio.emit('loadedmetadata');
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(audio.defaultPlaybackRate, 1.5);
  assert.equal(normalizePlaybackRate('0.75'), 0.75);
  assert.equal(normalizePlaybackRate(99), 1);
});

test('destroy removes media listeners and stops callbacks', async () => {
  const { audio, player, states, times } = setup();
  player.play();
  player.destroy();
  const stateCount = states.length, timeCount = times.length;
  audio.tick(44);
  audio.emit('canplay');
  await settle();
  assert.equal(states.length, stateCount);
  assert.equal(times.length, timeCount);
  assert.equal(audio.paused, true);
});
