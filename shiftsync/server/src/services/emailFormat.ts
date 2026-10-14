// Turns an email body (plain text, possibly edited by the student) into a
// simple HTML version where the important details are bold. The plain text
// stays the source of truth: it is sent alongside, unchanged, and the HTML
// only adds emphasis and list markup. Everything is escaped first, so names
// and titles can never inject markup.
import {
  formatDate,
  formatTime,
  parseDate,
} from "../../../src/domain/schedule";
import type { Conflict, ScheduleItem } from "../../../src/domain/types";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Phrases worth emphasising, taken from the conflict's own data: its date
 * (in the forms ShiftSync and the AI write it), each commitment's title and
 * times, and any deadline. Empty when the conflict is no longer on the
 * schedule; dates and times in ShiftSync's own format are still found then.
 */
export function emailHighlights(conflict: Conflict | null): string[] {
  if (!conflict) return [];
  const items = [conflict.first, conflict.second].filter(
    (item): item is ScheduleItem => !!item,
  );
  const dateForms = (date: string) => {
    const day = parseDate(date);
    return [
      formatDate(date),
      formatDate(date, true),
      `${day.toLocaleDateString("en-US", { month: "long" })} ${day.getDate()}`,
      `${day.toLocaleDateString("en-US", { month: "short" })} ${day.getDate()}`,
    ];
  };
  const phrases = [
    ...dateForms(conflict.date),
    ...items.flatMap((item) => {
      const [start, end] = [formatTime(item.start), formatTime(item.end)];
      return [
        // Short titles ("Work") would bold ordinary words, so they're skipped.
        ...(item.title.trim().length >= 3 ? [item.title.trim()] : []),
        `${start}–${end}`,
        `${start} to ${end}`,
        `${start} - ${end}`,
        start,
        end,
        ...(item.deadline
          ? [
              ...dateForms(item.deadline.slice(0, 10)),
              formatTime(item.deadline.slice(11, 16)),
            ]
          : []),
      ];
    }),
  ];
  return [...new Set(phrases)];
}

const WEEKDAYS = "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday";
const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
// ShiftSync's own formats (formatDate / formatTime), with an optional range.
const OWN_FORMATS = [
  `(?:${WEEKDAYS}), (?:${MONTHS}) \\d{1,2}(?:, \\d{4})?`,
  `\\d{1,2}:\\d{2}\\s?[AP]M(?:\\s?(?:–|-|to)\\s?\\d{1,2}:\\d{2}\\s?[AP]M)?`,
  "schedule conflict",
];

const BULLET = /^\s*[•\-*]\s+/;
const STYLE = {
  body: "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#252E4B;max-width:600px",
  p: "margin:0 0 16px",
  ul: "margin:0 0 16px;padding-left:22px",
  li: "margin:0 0 6px",
};

/** The email body as HTML, with important details in <strong>. */
export function renderEmailHtml(body: string, phrases: string[]): string {
  const alternatives = [
    ...phrases
      .filter((phrase) => phrase.trim())
      .sort((a, b) => b.length - a.length)
      .map((phrase) => escapeRegExp(escapeHtml(phrase))),
    ...OWN_FORMATS,
  ];
  // Whole words only, so a title inside a longer word stays plain.
  const pattern = new RegExp(
    `(?<![\\w])(?:${alternatives.join("|")})(?![\\w])`,
    "g",
  );
  // Each detail is bold once; repeating it every time would dilute it.
  const used = new Set<string>();
  const emphasise = (escaped: string) =>
    escaped.replace(pattern, (match) => {
      const key = match.toLowerCase();
      if (used.has(key)) return match;
      used.add(key);
      return `<strong>${match}</strong>`;
    });
  let askedQuestion = false;
  const blocks = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const html = blocks.map((block, index) => {
    const lines = block.split("\n");
    if (lines.every((line) => BULLET.test(line)))
      return `<ul style="${STYLE.ul}">${lines
        .map((line) => {
          const text = line.replace(BULLET, "");
          // "Label: value" — the label is the emphasis, as in a summary list.
          const split = text.lastIndexOf(": ");
          return split > 0
            ? `<li style="${STYLE.li}"><strong>${escapeHtml(text.slice(0, split + 1))}</strong> ${escapeHtml(text.slice(split + 2))}</li>`
            : `<li style="${STYLE.li}">${emphasise(escapeHtml(text))}</li>`;
        })
        .join("")}</ul>`;
    // The greeting and sign-off are never emphasised.
    const plain = index === 0 || index === blocks.length - 1;
    const rendered = lines.map((line) => {
      if (plain) return escapeHtml(line);
      // The first question is the request the reader has to act on.
      if (!askedQuestion) {
        const ask = /(^|[.!]\s+)([^.!?]*\?)/.exec(line);
        if (ask) {
          askedQuestion = true;
          const start = ask.index + ask[1].length;
          return `${emphasise(escapeHtml(line.slice(0, start)))}<strong>${escapeHtml(ask[2])}</strong>${emphasise(escapeHtml(line.slice(start + ask[2].length)))}`;
        }
      }
      return emphasise(escapeHtml(line));
    });
    return `<p style="${STYLE.p}">${rendered.join("<br>")}</p>`;
  });
  return `<!DOCTYPE html><html><body style="margin:0;padding:16px"><div style="${STYLE.body}">${html.join("")}</div></body></html>`;
}
