#!/usr/bin/env python3
"""Check that the app-source/ folder is identical, file by file, to the project ZIP.

Usage:  python3 scripts/verify-source-matches-zip.py [ZIP] [FOLDER]
        (defaults: large-pami-android-project.zip  app-source)

Compares: number of files, missing files, extra files, and the SHA-256 of every file.
Exit code 0 = identical. Exit code 1 = different (the build must stop).
Exit code 2 = the ZIP or the folder could not be read.
"""
import hashlib
import os
import sys
import zipfile

ZIP_PATH = sys.argv[1] if len(sys.argv) > 1 else "large-pami-android-project.zip"
SRC_DIR = sys.argv[2] if len(sys.argv) > 2 else "app-source"


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def zip_files(zip_path):
    files, empty_dirs = {}, []
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        for info in z.infolist():
            if info.is_dir():
                prefix = info.filename
                if not any(n != prefix and n.startswith(prefix) for n in names):
                    empty_dirs.append(prefix)
                continue
            files[info.filename] = sha256_bytes(z.read(info))
    return files, empty_dirs


def dir_files(src_dir):
    files, links = {}, []
    for root, dirs, names in os.walk(src_dir):
        dirs.sort()
        for n in sorted(names):
            full = os.path.join(root, n)
            rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
            if os.path.islink(full):
                links.append(rel)
                continue
            files[rel] = sha256_file(full)
    return files, links


def main():
    if not os.path.isfile(ZIP_PATH):
        print(f"::error::ZIP not found: {ZIP_PATH}")
        return 2
    if not os.path.isdir(SRC_DIR):
        print(f"::error::Folder not found: {SRC_DIR}")
        return 2

    zf, empty_dirs = zip_files(ZIP_PATH)
    df, links = dir_files(SRC_DIR)

    missing = sorted(set(zf) - set(df))   # in ZIP, not in folder
    extra = sorted(set(df) - set(zf))     # in folder, not in ZIP
    changed = sorted(p for p in set(zf) & set(df) if zf[p] != df[p])

    print(f"ZIP:    {ZIP_PATH}  files: {len(zf)}")
    print(f"Folder: {SRC_DIR}  files: {len(df)}")
    print(f"Missing in folder: {len(missing)}")
    print(f"Extra in folder:   {len(extra)}")
    print(f"Different SHA-256: {len(changed)}")
    print(f"Identical SHA-256: {len(set(zf) & set(df)) - len(changed)}")
    for p in missing:
        print(f"  MISSING  {p}")
    for p in extra:
        print(f"  EXTRA    {p}")
    for p in changed:
        print(f"  CHANGED  {p}  zip={zf[p]}  folder={df[p]}")
    for p in links:
        print(f"  SYMLINK  {p}  (symbolic links are not allowed in {SRC_DIR})")
    for p in empty_dirs:
        print(f"  NOTE     empty folder in ZIP (git cannot keep empty folders): {p}")

    if missing or extra or changed or links or len(zf) != len(df):
        print(f"::error::{SRC_DIR}/ and {ZIP_PATH} are NOT identical. "
              f"If you edited one of them, make the same change in the other "
              f"(or re-create the ZIP from {SRC_DIR}/). The build was stopped on purpose.")
        return 1
    print(f"OK: {SRC_DIR}/ is identical to {ZIP_PATH} ({len(zf)} files, SHA-256 of every file matches).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
