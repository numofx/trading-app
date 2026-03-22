import { DateTime } from "effect";

type DateStampProps = {
  date?: DateTime.DateTime.Input;
  label?: string;
};

export function DateStamp({
  date = DateTime.unsafeNow(),
  label = "Last modified",
}: DateStampProps) {
  const dt = DateTime.unsafeMake(date);

  const year = DateTime.getPart(dt, "year");
  const month = String(DateTime.getPart(dt, "month")).padStart(2, "0");
  const day = String(DateTime.getPart(dt, "day")).padStart(2, "0");

  const formatted = `${year}-${month}-${day}`;

  return (
    <span className="text-gray-500 text-xs dark:text-gray-400">
      {label}: {formatted}
    </span>
  );
}
