// Must be imported before @testing-library/react (and thus react-dom):
// react-dom checks `'AnimationEvent' in window` at module evaluation and
// never registers animationend listeners when it's missing, which silently
// kills every onAnimationEnd prop under jsdom.
if (typeof globalThis.AnimationEvent === "undefined") {
  class AnimationEventStub extends Event {
    animationName: string;
    elapsedTime: number;
    pseudoElement: string;
    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? "";
    }
  }
  globalThis.AnimationEvent = AnimationEventStub as unknown as typeof AnimationEvent;
}

export {};
