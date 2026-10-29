const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SEEK_TOLERANCE = 0.3;
const MAX_SEEK_ATTEMPTS = 12;

export function normalizePlaybackRate(value) {
  const rate = Number(value);
  return RATES.includes(rate) ? rate : 1;
}

/**
 * A single-file player with an explicit pending seek. Calling play() in the
 * original click handler unlocks the media element on mobile Safari; metadata
 * events may complete the requested seek later without changing its target.
 */
export class NotesPlayer {
  constructor(audio, { duration, onState = () => {}, onTime = () => {}, onError = () => {} } = {}) {
    if (!audio?.addEventListener) throw new TypeError('An audio element is required.');
    this.audio = audio;
    this._durationHint = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 0;
    this._onState = onState;
    this._onTime = onTime;
    this._onError = onError;
    this._pending = null;
    this._intended = false;
    this._loading = false;
    this._rate = 1;
    this._repeat = null;
    this._revision = 0;
    this._playInFlight = 0;
    this._playBlocked = false;
    this._applyingSeek = false;
    this._destroyed = false;
    this._lastState = '';
    this._listeners = [];

    this._listen('loadstart', () => {
      this._loading = true;
      this._applyRate();
      this._emitState();
    });
    for (const event of ['loadedmetadata', 'loadeddata', 'durationchange', 'progress', 'canplay']) {
      this._listen(event, () => this._mediaReady(event));
    }
    this._listen('seeked', () => {
      if (!this._confirmSeek() && !this._applyingSeek) this._trySeek();
      this._emitTime();
      this._emitState();
    });
    this._listen('timeupdate', () => this._timeUpdate());
    this._listen('play', () => {
      if (!this._intended) this.audio.pause();
      this._emitState();
    });
    this._listen('playing', () => {
      this._loading = Boolean(this._pending);
      this._emitState();
    });
    this._listen('pause', () => {
      // Safari can temporarily pause while a newly requested seek is loading.
      if (!this._pending && this._playInFlight === 0 && this.audio.paused && !this.audio.ended) this._intended = false;
      this._emitState();
    });
    for (const event of ['waiting', 'stalled']) {
      this._listen(event, () => {
        this._loading = this._intended || Boolean(this._pending);
        this._emitState();
      });
    }
    this._listen('ended', () => {
      if (this._repeat && this._intended) {
        this.seek(this._repeat.start, { play: true });
      } else {
        this._intended = false;
        this._loading = false;
        this._emitTime();
        this._emitState();
      }
    });
    this._listen('error', () => {
      this._revision++;
      this._intended = false;
      this._loading = false;
      this._playBlocked = true;
      this.audio.pause();
      this._emitState();
      this._onError('Audio could not load. Check your connection and press Play to retry.');
    });
  }

  get duration() {
    const actual = Number(this.audio.duration);
    return this._durationHint || (Number.isFinite(actual) && actual > 0 ? actual : 0);
  }

  get time() {
    return this._pending?.target ?? this._clampTime(this.audio.currentTime);
  }

  get playing() {
    return !this._destroyed && (this._intended || (!this.audio.paused && !this.audio.ended));
  }

  get pendingSeek() {
    return this._pending?.target ?? null;
  }

  seek(time, { play = false } = {}) {
    if (this._destroyed) return this.time;
    const target = this._clampTime(time);
    this._revision++;
    this._intended = Boolean(play);
    this._playBlocked = false;
    this._pending = { target, revision: this._revision, attempts: 0, applied: false, failed: false };
    this._loading = true;
    if (!play) this.audio.pause();
    this._trySeek();
    // Do not await metadata before invoking play(): that would lose the gesture.
    if (play) this._startPlayback();
    this._emitTime();
    this._emitState();
    return target;
  }

  play() {
    if (this._destroyed) return;
    const target = this.time;
    this._revision++;
    this._intended = true;
    this._playBlocked = false;
    if (this.audio.error) {
      this._pending = { target, revision: this._revision, attempts: 0, applied: false, failed: false };
      this._loading = true;
      this.audio.load();
    } else if (this._pending) {
      this._pending = { ...this._pending, revision: this._revision, attempts: 0, applied: false, failed: false };
    }
    this._trySeek();
    this._startPlayback();
    this._emitState();
  }

  pause() {
    if (this._destroyed) return;
    this._revision++;
    this._intended = false;
    this.audio.pause();
    this._emitState();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  restore(time) {
    // Restoring reading/listening position never starts audio.
    return this.seek(time, { play: false });
  }

  setRate(value) {
    if (this._destroyed) return this._rate;
    this._rate = normalizePlaybackRate(value);
    this._applyRate();
    this._emitState();
    return this._rate;
  }

  setRepeat(range) {
    if (!range) this._repeat = null;
    else {
      const start = this._clampTime(range.start);
      const end = this._clampTime(range.end);
      this._repeat = end > start ? { start, end } : null;
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._revision++;
    for (const [event, listener] of this._listeners) this.audio.removeEventListener(event, listener);
    this._listeners.length = 0;
    this._intended = false;
    this._pending = null;
    this.audio.pause();
  }

  _listen(event, listener) {
    this._listeners.push([event, listener]);
    this.audio.addEventListener(event, listener);
  }

  _clampTime(value) {
    const time = Number(value);
    return Number.isNaN(time) ? 0 : Math.max(0, Math.min(this.duration, time));
  }

  _applyRate() {
    if (this.audio.defaultPlaybackRate !== this._rate) this.audio.defaultPlaybackRate = this._rate;
    if (this.audio.playbackRate !== this._rate) this.audio.playbackRate = this._rate;
  }

  _confirmSeek() {
    const pending = this._pending;
    if (!pending || !pending.applied || pending.failed) return !pending;
    if (!this.audio.seeking && Math.abs(Number(this.audio.currentTime) - pending.target) <= SEEK_TOLERANCE) {
      this._pending = null;
      this._loading = false;
      return true;
    }
    return false;
  }

  _trySeek() {
    const pending = this._pending;
    if (!pending || pending.failed || this._applyingSeek || this.audio.readyState < 1) return;
    if (this._confirmSeek()) return;
    // Download progress during a valid in-flight seek must not restart it.
    if (pending.applied && this.audio.seeking && Math.abs(Number(this.audio.currentTime) - pending.target) <= SEEK_TOLERANCE) return;
    if (pending.attempts >= MAX_SEEK_ATTEMPTS) {
      pending.failed = true;
      this._loading = false;
      this._intended = false;
      this.audio.pause();
      this._onError('The selected passage could not be reached. Press Play to retry.');
      return;
    }
    pending.attempts++;
    pending.applied = true;
    this._applyingSeek = true;
    try {
      // Setting currentTime, rather than fastSeek, preserves passage precision.
      this.audio.currentTime = pending.target;
    } catch {
      pending.applied = false;
      // Some Safari versions expose metadata before accepting a distant seek.
      // Retry only on subsequent media readiness events, never in a tight loop.
    } finally {
      this._applyingSeek = false;
    }
  }

  _mediaReady(event) {
    this._applyRate();
    if (event === 'canplay' && !this._pending) this._loading = false;
    this._trySeek();
    if (this._intended && this.audio.paused && !this._playBlocked && this._playInFlight === 0 && !this._pending?.failed) {
      this._startPlayback();
    }
    this._emitTime();
    this._emitState();
  }

  _startPlayback() {
    if (this._destroyed || !this._intended || this._pending?.failed) return;
    const revision = this._revision;
    this._playInFlight++;
    this._applyRate();
    let promise;
    try { promise = this.audio.play(); }
    catch (error) { this._playRejected(error, revision); this._playInFlight--; return; }
    Promise.resolve(promise).then(() => {
      if (!this._destroyed && !this._intended) this.audio.pause();
    }, error => this._playRejected(error, revision)).finally(() => {
      this._playInFlight--;
      if (!this._destroyed) this._emitState();
    });
  }

  _playRejected(error, revision) {
    if (this._destroyed || revision !== this._revision) return;
    // AbortError can be caused by a seek/load replacing an earlier play request.
    if (error?.name === 'AbortError') return;
    this._intended = false;
    this._playBlocked = true;
    this._loading = false;
    this.audio.pause();
    this._emitState();
    this._onError(error?.name === 'NotAllowedError'
      ? 'Tap Play to hear the selected passage.'
      : 'Audio could not start. Press Play to retry.');
  }

  _timeUpdate() {
    this._confirmSeek();
    const actual = this._clampTime(this.audio.currentTime);
    if (!this._pending && this._intended && this._repeat && actual >= this._repeat.end - 0.04 && actual >= this._repeat.start) {
      this.seek(this._repeat.start, { play: true });
      return;
    }
    this._emitTime();
    this._emitState();
  }

  _emitTime() {
    if (!this._destroyed) this._onTime(this.time);
  }

  _emitState() {
    if (this._destroyed) return;
    const state = { playing: this.playing, loading: this._loading, pendingSeek: this.pendingSeek, rate: this._rate };
    const signature = JSON.stringify(state);
    if (signature !== this._lastState) {
      this._lastState = signature;
      this._onState(state);
    }
  }
}
