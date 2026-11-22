"""Tiny dBase III (.DBF) writer — enough for the SSO list disk. Pure stdlib."""

from __future__ import annotations

import datetime as _dt
import struct


def write(fields: list[tuple[str, str, int]], records: list[dict], encode=lambda s: s.encode("ascii", "replace")) -> bytes:
	"""fields: (NAME, 'C'|'N', length). Text is passed through `encode`, left-
	aligned and space-padded; numbers are right-aligned integers. A value too
	wide for its column raises ValueError (never silently truncated for N)."""
	record_len = 1 + sum(f[2] for f in fields)
	header_len = 32 + 32 * len(fields) + 1
	today = _dt.date.today()
	out = bytearray(
		struct.pack("<BBBBIHH20x", 0x03, today.year - 1900, today.month, today.day, len(records), header_len, record_len)
	)
	for name, ftype, length in fields:
		out += struct.pack("<11sc4xBB14x", name.encode("ascii").ljust(11, b"\x00"), ftype.encode(), length, 0)
	out += b"\x0d"
	for rec in records:
		out += b" "
		for name, ftype, length in fields:
			value = rec.get(name)
			if ftype == "N":
				text = str(int(round(float(value or 0)))).encode("ascii")
				if len(text) > length:
					raise ValueError(f"{name}: {value} does not fit in {length} digits")
				out += text.rjust(length, b" ")
			else:
				data = encode(str(value or ""))[:length]
				out += data.ljust(length, b" ")
	out += b"\x1a"
	return bytes(out)


def read(data: bytes) -> tuple[list, list]:
	"""Parse what write() produced (used by tests)."""
	count, header_len, record_len = struct.unpack("<IHH", data[4:12])
	fields, pos = [], 32
	while data[pos] != 0x0D:
		name = data[pos : pos + 11].split(b"\x00")[0].decode()
		fields.append((name, chr(data[pos + 11]), data[pos + 16]))
		pos += 32
	rows, pos = [], header_len
	for _ in range(count):
		rec, p = {}, pos + 1
		for name, ftype, length in fields:
			raw = data[p : p + length]
			rec[name] = int(raw.strip() or 0) if ftype == "N" else raw.rstrip(b" ")
			p += length
		rows.append(rec)
		pos += record_len
	return fields, rows
