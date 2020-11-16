import collCheckable from "./collCheckable";
import predCheckable from "./predCheckable";

export default function checkable(spec, initialValue, options) {
  if (typeof spec === "function")
    return predCheckable(spec, initialValue, options);

  return collCheckable(spec, initialValue, options, checkable);
}
