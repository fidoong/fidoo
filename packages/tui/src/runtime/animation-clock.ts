const listeners = new Set<() => void>();
let frame = 0;
let timer: ReturnType<typeof setInterval> | undefined;

export function subscribeAnimation(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      frame = (frame + 1) % 240;
      for (const current of listeners) {
        current();
      }
    }, 120);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function animationFrame(): number {
  return frame;
}
