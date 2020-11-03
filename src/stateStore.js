import { writable } from "svelte/store";

export default function stateStore(initialValue, cb) {
  let _state = initialValue;
  const store = writable(initialValue, cb);

  function set(newValue) {
    _state = newValue;
    store.set(newValue);
  }

  return {
    get: () => _state,
    reset: () => set(initialValue),
    set,
    subscribe: store.subscribe,
    update: (fn) => set(fn(_state)),
  };
}
