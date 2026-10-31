export interface DiffPart {
  kind: "same" | "add" | "del";
  text: string;
}

/** Word-level diff via a classic LCS table. Adjacent parts of the same kind are merged. */
export function wordDiff(before: string, after: string): DiffPart[] {
  // Words and the whitespace between them, so joining the tokens reproduces the text.
  const a = before.split(/(\s+)/).filter((t) => t.length > 0);
  const b = after.split(/(\s+)/).filter((t) => t.length > 0);
  const n = a.length;
  const m = b.length;
  // lcs[i * (m + 1) + j] = LCS length of a[i..] and b[j..]
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] =
        a[i] === b[j] ? (lcs[(i + 1) * (m + 1) + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * (m + 1) + j] ?? 0, lcs[i * (m + 1) + j + 1] ?? 0);
    }
  }
  const ops: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ta = a[i] ?? "";
    const tb = b[j] ?? "";
    if (ta === tb) {
      ops.push({ kind: "same", text: ta });
      i++;
      j++;
    } else if ((lcs[(i + 1) * (m + 1) + j] ?? 0) >= (lcs[i * (m + 1) + j + 1] ?? 0)) {
      ops.push({ kind: "del", text: ta });
      i++;
    } else {
      ops.push({ kind: "add", text: tb });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: "del", text: a[i] ?? "" });
  for (; j < m; j++) ops.push({ kind: "add", text: b[j] ?? "" });

  // Group each run of changes (bridging gaps of at most one unchanged word) into one deletion
  // followed by one insertion, so a rewritten phrase reads as old → new instead of word soup.
  const parts: DiffPart[] = [];
  let del = "";
  let add = "";
  const flush = (): void => {
    if (del !== "") parts.push({ kind: "del", text: del });
    if (add !== "") parts.push({ kind: "add", text: add });
    del = "";
    add = "";
  };
  ops.forEach((op, k) => {
    if (op.kind === "del") del += op.text;
    else if (op.kind === "add") add += op.text;
    else if ((del !== "" || add !== "") && ops.slice(k + 1, k + 4).some((next) => next.kind !== "same")) {
      del += op.text;
      add += op.text;
    } else {
      flush();
      const last = parts[parts.length - 1];
      if (last !== undefined && last.kind === "same") last.text += op.text;
      else parts.push({ kind: "same", text: op.text });
    }
  });
  flush();
  return parts;
}
