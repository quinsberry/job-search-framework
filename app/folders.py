"""Select a folder on the computer running this local app."""
from pathlib import Path
import subprocess
import sys
import threading


LOCK = threading.Lock()


def select():
    if not LOCK.acquire(blocking=False):
        raise ValueError('A folder picker is already open on this computer.')
    try:
        if sys.platform == 'darwin':
            command = ['osascript', '-e', 'POSIX path of (choose folder with prompt "Select your job-search workspace")']
        else:
            code = ('import tkinter as t; from tkinter.filedialog import askdirectory; '
                    'root=t.Tk(); root.withdraw(); '
                    'print(askdirectory(title="Select your job-search workspace", mustexist=True)); root.destroy()')
            command = [sys.executable, '-c', code]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=180)
        except (OSError, subprocess.TimeoutExpired):
            raise ValueError('Could not open the native folder picker. Enter a workspace path instead.') from None
        if result.returncode:
            if sys.platform == 'darwin' and '-128' in result.stderr:
                return None
            raise ValueError('Native folder picker unavailable. Enter a workspace path instead.')
        value = result.stdout.strip()
        if not value:
            return None
        path = Path(value).resolve()
        if not path.is_dir():
            raise ValueError('Selected workspace directory does not exist.')
        return str(path)
    finally:
        LOCK.release()
