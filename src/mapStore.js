import { writable } from "svelte/store";

const mapStore = (initialKeys) => {
  let state = new Map(initialKeys);
  const store = writable(state);

  function get() {
    return state;
  }

  function remove(keys) {
    store.update((prev) => {
      state = keys.reduce((map, key) => {
        map.delete(key);
        return map;
      }, prev);
      return state;
    });
  }

  function removeOne(key) {
    store.update((prev) => {
      prev.delete(key);
      state = prev;
      return prev;
    });
  }

  function set(entries, { exclusive = false } = {}) {
    store.update((prev) => {
      const updated = entries.reduce(
        (map, [key, val]) => map.set(key, val),
        prev
      );
      if (!exclusive) {
        state = updated;
        return state;
      }

      /* If `exclusive`, only the set entries should be kept. */
      const keys = entries.map(([k]) => k);
      const keysToRemove = Array.from(updated.keys()).filter(
        (k) => !keys.includes(k)
      );
      state = keysToRemove.reduce((map, key) => {
        map.delete(key);
        return map;
      }, updated);
      return state;
    });
  }

  function setOne(key, val) {
    store.update((prev) => {
      state = prev.set(key, val);
      return state;
    });
  }

  function update(entries) {
    store.update((prev) => {
      state = entries.reduce((map, [key, fn]) => {
        if (typeof fn !== "function") return map;
        return map.set(key, fn(map.get(key)));
      }, prev);
      return state;
    });
  }

  function updateOne(key, fn) {
    store.update((prev) => {
      state = prev.set(key, fn(prev.get(key)));
      return state;
    });
  }

  return {
    get,
    remove,
    removeOne,
    set,
    setOne,
    subscribe: store.subscribe,
    update,
    updateOne,
  };
};

export default mapStore;
