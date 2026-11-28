// An object schema that tolerates unknown keys, which verax's `object` does not: for files other programs write.
// Imported as `#loose` (package.json imports), as the lint rule bars a parent import.
import { type ObjectOf, type Schema, type Shape, is, object, record, scalar, unknown } from 'verax';

const fields = record(unknown());

/**
the object that holds `shape`'s keys and says nothing of the rest: those keys are picked out, then checked exactly
*/
const loose = <TShape extends Shape>(name: string, shape: TShape): Schema<ObjectOf<TShape>> => {
  const exact = object(name, shape);
  return scalar(
    name,
    (value: unknown): value is ObjectOf<TShape> =>
      is(value, fields) &&
      is(
        Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(shape, key))),
        exact,
      ),
  );
};

export { loose };
