from __future__ import annotations

import json
import struct
from pathlib import Path


def read_bytes(path: Path) -> bytes:
    with path.open("rb") as fh:
        return fh.read()


def check_zip_signature(data: bytes) -> dict:
    signatures = {
        "local_file_header": data.startswith(b"PK\x03\x04"),
        "central_directory": b"PK\x01\x02" in data,
        "end_of_central_directory": b"PK\x05\x06" in data,
    }
    return signatures


def find_local_headers(data: bytes, limit: int = 10):
    results = []
    start = 0
    while len(results) < limit:
        idx = data.find(b"PK\x03\x04", start)
        if idx == -1 or idx + 30 > len(data):
            break
        try:
            header = struct.unpack("<4sHHHHIIIHH", data[idx : idx + 30])
        except struct.error:
            break
        _, version, flag, method, mtime, mdate, crc, comp_size, uncomp_size, name_len, extra_len = header
        name_start = idx + 30
        name_end = name_start + name_len
        name = data[name_start:name_end]
        results.append(
            {
                "offset": idx,
                "version": version,
                "flag": flag,
                "method": method,
                "compressed_size": comp_size,
                "uncompressed_size": uncomp_size,
                "name": name.decode("utf-8", "replace"),
            }
        )
        start = name_end + extra_len + comp_size
    return results


def inspect_epub(epub_path: Path) -> dict:
    data = read_bytes(epub_path)
    signatures = check_zip_signature(data)
    local_headers = find_local_headers(data)
    eocd_index = data.rfind(b"PK\x05\x06")
    eocd = None
    if eocd_index != -1 and eocd_index + 22 <= len(data):
        try:
            fields = struct.unpack("<4s4H2LH", data[eocd_index : eocd_index + 22])
            _, disk_idx, disk_cd_start, disk_records, total_records, cd_size, cd_offset, comment_len = fields
            eocd = {
                "offset": eocd_index,
                "disk_index": disk_idx,
                "cd_disk_index": disk_cd_start,
                "records_on_disk": disk_records,
                "total_records": total_records,
                "central_directory_size": cd_size,
                "central_directory_offset": cd_offset,
                "comment_length": comment_len,
            }
        except struct.error:
            pass

    return {
        "file": str(epub_path),
        "size": len(data),
        "zip_signatures": signatures,
        "local_headers_sample": local_headers,
        "end_of_central_directory": eocd,
        "tail_bytes": data[-64:].hex(),
    }


def main() -> None:
    epub_dir = Path("dataset/Jobless reincarnation")
    reports = []
    for epub_path in sorted(epub_dir.glob("*.epub")):
        reports.append(inspect_epub(epub_path))
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()

