# Changelog

## [2.2.0] - 2020-11-24

### Break

### Grow

### Fix

- Use `reset` with initial value in `submitable`;

### Deprecate

---

## [2.1.2] - 2020-11-23

### Break

### Grow

### Fix

- Reset `response` to `undefined` (instead of `{}`) on each submit;

### Deprecate

---

## [2.1.1] - 2020-11-23

### Break

### Grow

### Fix

- Deep clone initial value (instead of a mere shallow copy) before passing it to `onReset` callback;

### Deprecate

---

## [2.1.0] - 2020-11-20

### Break

- Remove default export;

### Grow

- Add `submitable` store, that facilitates usage of `checkable` in forms;

### Fix

### Deprecate

---

## [2.0.2] - 2020-11-19

### Break

### Grow

- Allow defining `required` as functions so that they can be combined like specs.

### Fix

### Deprecate

---

## [2.0.1] - 2020-11-17

### Break

### Grow

### Fix

- Check for non required undefined values in `predCheckable`, not in `collCheckable`, as undefined value could eventually change, but spec would still be fixed to always true.

### Deprecate

---

## [2.0.0] - 2020-11-16

### Break

- Complete refactoring to get a working set of `checkable` stores.

### Grow

### Fix

### Deprecate

---

## [1.1.0] - 2020-11-03

Initial working code.
