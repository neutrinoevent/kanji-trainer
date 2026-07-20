#!/usr/bin/env python3
"""Update Kanji Trainer in place.

Fetches the latest version from GitHub and replaces the app files.
Your progress (data/trainer.db) is never modified, and a backup copy
is written to data/trainer.db.bak before anything else happens.

Works two ways:
  - if this folder is a git clone and git is installed, it runs git pull
  - otherwise it downloads the repository zip and copies the files over

Usage: python update.py   (or double-click update.bat on Windows)
"""

import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
REPO_ZIP = "https://codeload.github.com/neutrinoevent/kanji-trainer/zip/refs/heads/main"
# user data: never copied over, never deleted
PRESERVE = {"trainer.db", "trainer.db-wal", "trainer.db-shm", "trainer.db.bak"}


def backup_db():
    db = os.path.join(BASE, "data", "trainer.db")
    if os.path.exists(db):
        shutil.copy2(db, db + ".bak")
        print("Progress backed up to data/trainer.db.bak")


def git_update():
    if not os.path.isdir(os.path.join(BASE, ".git")) or shutil.which("git") is None:
        return False
    print("This folder is a git clone; updating with git pull...")
    r = subprocess.run(["git", "pull", "--ff-only", "origin", "main"], cwd=BASE)
    if r.returncode != 0:
        print("git pull did not succeed; falling back to the zip download.")
        return False
    return True


def zip_update():
    print("Downloading the latest version...")
    with tempfile.TemporaryDirectory() as tmp:
        zpath = os.path.join(tmp, "kanji-trainer.zip")
        urllib.request.urlretrieve(REPO_ZIP, zpath)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(tmp)
        src = next(
            p for p in (os.path.join(tmp, d) for d in os.listdir(tmp))
            if os.path.isdir(p)
        )
        copied = 0
        for root, _dirs, files in os.walk(src):
            rel = os.path.relpath(root, src)
            for name in files:
                if name in PRESERVE:
                    continue
                dst_dir = BASE if rel == "." else os.path.join(BASE, rel)
                os.makedirs(dst_dir, exist_ok=True)
                shutil.copy2(os.path.join(root, name), os.path.join(dst_dir, name))
                copied += 1
        print(f"Updated {copied} files.")


def main():
    print("Kanji Trainer updater")
    print("If the app is running, close it first, then run this again.\n")
    backup_db()
    if not git_update():
        zip_update()
    print("\nDone. Your progress database was not modified.")
    print("Start the app with run.bat (Windows) or ./run.sh (macOS/Linux).")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # keep the window readable for non-technical users
        print(f"\nUpdate failed: {e}")
        print("Nothing was changed that can't be fixed by re-downloading the app;")
        print("your progress lives in data/trainer.db and was backed up first.")
        sys.exit(1)
