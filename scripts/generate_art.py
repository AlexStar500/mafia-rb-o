#!/usr/bin/env python3
"""Generate high resolution pixel art for MAFIA via ASCL.

The game uses ASCL (A Script Capture Language) for role icons, bot
portraits and the brand mark.  Everything is authored as explicit pixel
grids here, then compiled by the user's own ascl.py compiler.

Usage:
    python scripts/generate_art.py
    python scripts/generate_art.py --preview
"""
from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASCL = Path(r"C:\Users\house\OneDrive\Документы\AProjects\ASCL\ascl.py")
OUT_ASCL = ROOT / "assets" / "ascl"
OUT_ROLES = ROOT / "assets" / "img" / "roles"
OUT_BOTS = ROOT / "assets" / "img" / "bots"
OUT_BRAND = ROOT / "assets" / "img" / "brand"


class Canvas:
    def __init__(self, size: int = 24, cell: int = 8):
        self.w = size
        self.h = size
        self.cell = cell
        self.grid = [[0] * size for _ in range(size)]
        self.palette: list[str] = []

    def add(self, color: str) -> int:
        color = color.upper().lstrip("#")
        if color not in self.palette:
            self.palette.append(color)
        return self.palette.index(color) + 1

    def px(self, x: int, y: int, color: str | int, alpha: bool = True) -> None:
        if not (0 <= x < self.w and 0 <= y < self.h):
            return
        idx = color if isinstance(color, int) else (self.add(color) if alpha else 0)
        self.grid[y][x] = idx

    def rect(self, x: int, y: int, w: int, h: int, color: str | int) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, color)

    def box(self, x: int, y: int, w: int, h: int, fill: str, outline: str) -> None:
        self.rect(x, y, w, h, outline)
        if w > 2 and h > 2:
            self.rect(x + 1, y + 1, w - 2, h - 2, fill)

    def line(self, x0: int, y0: int, x1: int, y1: int, color: str, thick: int = 1) -> None:
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            for tx in range(thick):
                for ty in range(thick):
                    self.px(x0 + tx, y0 + ty, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, color: str) -> None:
        for y in range(self.h):
            for x in range(self.w):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.px(x, y, color)

    def ring(self, cx: float, cy: float, rx: float, ry: float, thick: float, color: str) -> None:
        for y in range(self.h):
            for x in range(self.w):
                d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
                inner = max(0.0, (rx - thick) / rx) ** 2
                if inner <= d <= 1:
                    self.px(x, y, color)

    def poly(self, points: list[tuple[float, float]], color: str) -> None:
        """Scanline fill for a closed polygon."""
        if not points:
            return
        ys = [p[1] for p in points]
        for y in range(max(0, int(min(ys))), min(self.h, int(max(ys)) + 1)):
            sy = y + 0.5
            xs: list[float] = []
            for i in range(len(points)):
                x1, y1 = points[i]
                x2, y2 = points[(i + 1) % len(points)]
                if (y1 <= sy < y2) or (y2 <= sy < y1):
                    t = (sy - y1) / (y2 - y1)
                    xs.append(x1 + t * (x2 - x1))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(max(0, int(math.ceil(xs[i] - 0.5))), min(self.w, int(math.floor(xs[i + 1] - 0.5)) + 1)):
                    self.px(x, y, color)

    def outline(self, color: str, diagonal: bool = False) -> None:
        """Add an outline around non-transparent pixels."""
        source = [row[:] for row in self.grid]
        neighbours = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if diagonal:
            neighbours += [(1, 1), (-1, -1), (1, -1), (-1, 1)]
        edge: list[tuple[int, int]] = []
        for y in range(self.h):
            for x in range(self.w):
                if source[y][x] != 0:
                    continue
                if any(0 <= x + dx < self.w and 0 <= y + dy < self.h and source[y + dy][x + dx] != 0 for dx, dy in neighbours):
                    edge.append((x, y))
        for x, y in edge:
            self.px(x, y, color)

    def glyph(self, x: int, y: int, char: str, color: str, scale: int = 1) -> None:
        rows = FONT3x5.get(char.upper())
        if not rows:
            return
        for gy, row in enumerate(rows):
            for gx, bit in enumerate(row):
                if bit == "1":
                    self.rect(x + gx * scale, y + gy * scale, scale, scale, color)

    def ascl(self) -> str:
        lines = [
            f"<type={self.cell}px{self.cell}px>",
            "<form=custom>",
            "<palette>",
        ]
        for i, color in enumerate(self.palette, 1):
            lines.append(f"  {i} = #{color}")
        lines += ["</palette>", "<img"]
        for row in self.grid:
            lines.append("  " + " ".join("." if v == 0 else str(v) for v in row))
        lines += [">", '<convert format="png">']
        return "\n".join(lines) + "\n"

    def save(self, path: Path, script_path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        script_path.parent.mkdir(parents=True, exist_ok=True)
        script_path.write_text(self.ascl(), encoding="utf-8")
        subprocess.run(
            [sys.executable, str(ASCL), str(script_path), "-o", str(path), "-q"],
            check=True,
            cwd=str(ROOT),
        )


FONT3x5 = {
    "A": ["010", "101", "111", "101", "101"],
    "B": ["110", "101", "110", "101", "110"],
    "C": ["011", "100", "100", "100", "011"],
    "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"],
    "F": ["111", "100", "110", "100", "100"],
    "G": ["011", "100", "101", "101", "011"],
    "H": ["101", "101", "111", "101", "101"],
    "I": ["111", "010", "010", "010", "111"],
    "J": ["001", "001", "001", "101", "010"],
    "K": ["101", "101", "110", "101", "101"],
    "L": ["100", "100", "100", "100", "111"],
    "M": ["101", "111", "111", "101", "101"],
    "N": ["101", "111", "111", "111", "101"],
    "O": ["010", "101", "101", "101", "010"],
    "P": ["110", "101", "110", "100", "100"],
    "Q": ["010", "101", "101", "111", "011"],
    "R": ["110", "101", "110", "101", "101"],
    "S": ["011", "100", "010", "001", "110"],
    "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "011"],
    "V": ["101", "101", "101", "101", "010"],
    "W": ["101", "101", "111", "111", "101"],
    "X": ["101", "101", "010", "101", "101"],
    "Y": ["101", "101", "010", "010", "010"],
    "Z": ["111", "001", "010", "100", "111"],
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["110", "001", "010", "100", "111"],
    "3": ["110", "001", "010", "001", "110"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "110", "001", "110"],
    "6": ["011", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "110"],
    "?": ["111", "001", "011", "000", "010"],
    "!": ["010", "010", "010", "000", "010"],
    ".": ["000", "000", "000", "000", "010"],
    "-": ["000", "000", "111", "000", "000"],
}


def mafia_icon() -> Canvas:
    c = Canvas(24, 8)
    ink = c.add("07080D")
    hat = c.add("1B1C27")
    hat2 = c.add("2B2D3E")
    hi = c.add("44465C")
    band = c.add("8E1B2E")
    band2 = c.add("D23A4D")
    skin = c.add("8C6148")
    skin2 = c.add("B98162")
    eye = c.add("FF4655")
    gold = c.add("D9B36C")
    # fedora crown
    c.poly([(7, 3), (17, 3), (19, 12), (5, 12)], hat)
    c.poly([(8, 4), (12, 4), (11, 11), (6, 11)], hat2)
    c.line(8, 4, 7, 10, hi)
    # crown dent
    c.line(9, 4, 14, 4, ink)
    c.line(10, 5, 13, 5, hat)
    # band
    c.rect(5, 9, 14, 2, band)
    c.line(6, 9, 17, 9, band2)
    c.px(16, 10, gold)
    # brim
    c.ellipse(12, 13.2, 10.6, 3.4, hat)
    c.poly([(1, 13), (23, 13), (21, 15), (3, 15)], hat2)
    c.line(3, 12, 20, 12, hi)
    # shadowed face
    c.ellipse(12, 18.6, 5.4, 5.2, skin)
    c.rect(7, 14, 10, 2, ink)
    c.ellipse(9.2, 18, 1.35, 1.25, eye)
    c.ellipse(14.8, 18, 1.35, 1.25, eye)
    c.px(9, 18, c.add("FFD3D6"))
    c.px(15, 18, c.add("FFD3D6"))
    c.line(10, 21, 14, 21, c.add("4A2D25"))
    c.px(8, 20, skin2)
    c.px(16, 20, skin2)
    # collar
    c.poly([(6, 22), (9, 20), (12, 23), (15, 20), (18, 22), (17, 24), (7, 24)], hat)
    c.line(9, 21, 12, 23, hat2)
    c.line(15, 21, 12, 23, hat2)
    c.outline(ink)
    return c


def sheriff_icon() -> Canvas:
    c = Canvas(24, 8)
    ink = c.add("0B0905")
    dark = c.add("3A2A0C")
    gold = c.add("C89B3C")
    gold2 = c.add("F0CC73")
    gold3 = c.add("8F651B")
    navy = c.add("18243B")
    navy2 = c.add("24344F")
    white = c.add("FFF1C2")
    # shield
    c.poly([(3, 2), (21, 2), (21, 8), (20, 13), (17, 17), (12, 22), (7, 17), (4, 13), (3, 8)], dark)
    c.poly([(4, 3), (20, 3), (20, 8), (19, 12), (16.5, 16), (12, 20.5), (7.5, 16), (5, 12), (4, 8)], gold)
    # bevel
    c.line(5, 4, 19, 4, gold2)
    c.line(5, 4, 5, 11, gold2)
    c.line(19, 4, 19, 10, gold3)
    c.line(8, 16, 12, 19, gold3)
    # inner
    c.poly([(6, 5), (18, 5), (18, 9), (17, 12), (15, 15), (12, 18), (9, 15), (7, 12), (6, 9)], navy)
    c.poly([(7, 6), (17, 6), (17, 9), (16, 12), (14, 14.5), (12, 16.5), (10, 14.5), (8, 12), (7, 9)], navy2)
    # star
    star = [(12, 6.2), (13.5, 10.2), (17.6, 10.2), (14.2, 12.6), (15.5, 16.6), (12, 14.1), (8.5, 16.6), (9.8, 12.6), (6.4, 10.2), (10.5, 10.2)]
    c.poly(star, gold2)
    c.poly([(12, 8), (13, 11), (16, 11), (13.6, 12.8), (14.5, 15.6), (12, 13.8), (9.5, 15.6), (10.4, 12.8), (8, 11), (11, 11)], gold)
    # shine
    c.px(9, 7, white)
    c.px(10, 7, white)
    c.px(9, 8, white)
    c.outline(ink)
    return c


def civilian_icon() -> Canvas:
    c = Canvas(24, 8)
    ink = c.add("070B09")
    coat = c.add("1A302B")
    coat2 = c.add("26463D")
    green = c.add("3E8F62")
    green2 = c.add("6FD39A")
    skin = c.add("D8A47C")
    skin2 = c.add("F0C4A0")
    hair = c.add("4A3126")
    cap = c.add("2D5C45")
    cap2 = c.add("3E7F5D")
    white = c.add("F6F1E2")
    # shoulders
    c.poly([(3, 24), (4, 19), (8, 16), (16, 16), (20, 19), (21, 24)], coat)
    c.poly([(5, 24), (6, 20), (9, 18), (12, 22), (15, 18), (18, 20), (19, 24)], coat2)
    c.line(12, 18, 12, 24, ink)
    c.px(10, 21, white)
    c.px(10, 22, white)
    # neck / scarf
    c.rect(10, 14, 4, 3, skin)
    c.rect(7, 15, 10, 2, green)
    c.px(7, 17, green2)
    c.px(16, 17, green2)
    c.rect(14, 17, 2, 5, green)
    c.line(14, 18, 15, 21, green2)
    # head
    c.ellipse(12, 9.2, 4.7, 5.2, skin)
    c.ellipse(11, 9, 3.2, 4.1, skin2)
    c.px(9, 10, ink)
    c.px(14, 10, ink)
    c.line(10, 12, 13, 12, c.add("8E5B45"))
    c.px(10, 9, ink)
    c.px(11, 9, ink)
    c.px(14, 9, ink)
    c.px(15, 9, ink)
    # flat cap
    c.poly([(6, 7), (8, 4), (15, 4), (18, 7), (17, 9), (7, 9)], cap)
    c.line(8, 4, 15, 4, cap2)
    c.line(7, 8, 17, 8, cap2)
    c.rect(5, 7, 4, 2, cap2)
    c.line(9, 3, 14, 3, cap)
    c.outline(ink)
    return c


def doctor_icon() -> Canvas:
    c = Canvas(24, 8)
    ink = c.add("050A0C")
    dark = c.add("123039")
    teal = c.add("1B4B57")
    teal2 = c.add("276B79")
    teal3 = c.add("3C93A3")
    white = c.add("EAF7F4")
    gray = c.add("A9C9CC")
    red = c.add("C93A48")
    gold = c.add("D9B36C")
    # handle
    c.ring(12, 7, 4.2, 3.2, 1.2, gray)
    c.rect(8, 8, 8, 3, teal2)
    # bag body
    c.poly([(3, 9), (21, 9), (22, 21), (20, 23), (4, 23), (2, 21)], ink)
    c.poly([(4, 10), (20, 10), (21, 20), (19, 22), (5, 22), (3, 20)], teal)
    c.poly([(4, 10), (20, 10), (20, 14), (4, 14)], teal2)
    c.line(4, 11, 19, 11, teal3)
    # latch
    c.rect(10, 13, 4, 3, gold)
    c.px(11, 14, ink)
    # cross
    c.rect(10, 15, 4, 6, white)
    c.rect(8, 17, 8, 3, white)
    c.rect(11, 16, 2, 4, red)
    c.rect(9, 18, 6, 1, red)
    # shine
    c.line(5, 12, 5, 19, teal3)
    c.px(6, 21, teal2)
    c.outline(ink)
    return c


def assassin_icon() -> Canvas:
    c = Canvas(24, 8)
    ink = c.add("09070B")
    steel = c.add("B9C6D6")
    steel2 = c.add("E9F1FA")
    steel3 = c.add("6D7C93")
    edge = c.add("344255")
    blood = c.add("8E1B2E")
    blood2 = c.add("F1465A")
    hilt = c.add("2A1B2C")
    gold = c.add("C79A45")
    glow = c.add("4A1020")
    # aura (sparse)
    for x, y in [(19, 3), (20, 4), (5, 19), (4, 20), (3, 18)]:
        c.px(x, y, glow)
    # blade from top right to middle
    c.poly([(20, 2), (22, 3), (11, 15), (9, 14)], steel)
    c.poly([(20, 3), (21, 3), (10, 14), (9.4, 13.5)], steel2)
    c.poly([(21, 4), (22, 4), (10, 15), (9.4, 14.4)], steel3)
    c.line(20, 2, 15, 8, edge)
    # cross guard
    c.poly([(7, 13), (12, 12), (14, 15), (9, 17)], gold)
    c.line(8, 14, 12, 13, c.add("F0D18A"))
    # grip
    c.poly([(6, 16), (9, 18), (6, 22), (3, 20)], hilt)
    c.line(5, 18, 8, 20, gold)
    c.px(4, 21, gold)
    # blood drops
    c.px(12, 16, blood)
    c.px(12, 17, blood2)
    c.px(13, 18, blood)
    c.px(11, 19, blood2)
    c.px(15, 13, blood)
    c.px(16, 14, blood2)
    c.outline(ink)
    return c


def jester_icon() -> Canvas:
    c = Canvas(24, 8)
    ink = c.add("08060C")
    purple = c.add("5B2A86")
    purple2 = c.add("8040B8")
    purple3 = c.add("B47BE0")
    lilac = c.add("D7B6F2")
    gold = c.add("D9B36C")
    gold2 = c.add("F6DB94")
    ivory = c.add("F1EADB")
    ivory2 = c.add("C9BFAE")
    red = c.add("B62F46")
    eye = c.add("2A1638")
    # hat base
    c.rect(4, 10, 16, 4, purple)
    c.rect(5, 11, 14, 2, purple2)
    # three points
    c.poly([(5, 11), (1, 5), (4, 3), (9, 10)], purple)
    c.poly([(19, 11), (23, 5), (20, 3), (15, 10)], purple)
    c.poly([(9, 10), (12, 1), (15, 10)], purple2)
    c.line(12, 2, 12, 9, purple3)
    c.line(3, 5, 7, 10, purple3)
    c.line(21, 5, 17, 10, purple3)
    # bells
    for x, y in [(2, 4), (21, 4), (12, 1)]:
        c.ellipse(x + 0.5, y + 0.5, 1.5, 1.5, gold)
        c.px(x, y, gold2)
    # curls / stripes
    c.px(6, 9, red)
    c.px(8, 9, red)
    c.px(15, 9, red)
    c.px(17, 9, red)
    c.px(6, 10, red)
    c.px(16, 10, red)
    # collar
    c.poly([(3, 20), (6, 14), (10, 15), (12, 18), (14, 15), (18, 14), (21, 20), (19, 22), (5, 22)], purple)
    c.line(6, 15, 4, 20, purple3)
    c.line(18, 15, 20, 20, purple3)
    # mask
    c.ellipse(12, 15.2, 5.8, 4.2, ivory)
    c.poly([(7, 14), (10, 13), (10, 16), (8, 18)], eye)
    c.poly([(14, 13), (17, 14), (16, 18), (14, 16)], eye)
    c.px(9, 14, red)
    c.px(15, 14, red)
    c.line(10, 18, 12, 19, ivory2)
    c.line(12, 19, 14, 18, ivory2)
    c.poly([(9, 20), (12, 19), (15, 20), (12, 22)], red)
    c.line(9, 20, 15, 20, gold)
    c.outline(ink)
    return c


def brand_icon() -> Canvas:
    c = Canvas(32, 16)
    ink = c.add("06070C")
    night = c.add("101426")
    night2 = c.add("18203A")
    gold = c.add("D9B36C")
    gold2 = c.add("F5DEA6")
    red = c.add("A81F32")
    red2 = c.add("E04455")
    hat = c.add("1B1E2C")
    hat2 = c.add("2A2F42")
    hi = c.add("59607A")
    # circular badge
    c.ellipse(16, 16, 15.4, 15.4, ink)
    c.ellipse(16, 16, 14.5, 14.5, gold)
    c.ellipse(16, 16, 13.3, 13.3, night)
    c.ring(16, 16, 13.3, 13.3, 0.8, night2)
    # moon
    c.ellipse(25, 8, 3.2, 3.2, gold2)
    c.ellipse(26.2, 7.2, 2.8, 2.8, night)
    # tiny stars
    for x, y in [(6, 7), (8, 4), (4, 13), (27, 15), (24, 21)]:
        c.px(x, y, gold2)
    # fedora
    c.poly([(10, 8), (22, 8), (23, 16), (9, 16)], hat)
    c.poly([(11, 9), (15, 9), (14, 15), (9, 15)], hat2)
    c.line(11, 9, 10, 13, hi)
    c.line(13, 9, 19, 9, ink)
    c.rect(9, 13, 15, 2, red)
    c.line(10, 13, 21, 13, red2)
    c.ellipse(16, 17, 12.5, 3.6, hat)
    c.poly([(4, 17), (28, 17), (26, 19), (6, 19)], hat2)
    c.line(6, 16, 25, 16, hi)
    # shadow face with eyes
    c.ellipse(16, 23, 3.6, 3.2, ink)
    c.px(14, 22, red2)
    c.px(18, 22, red2)
    # ribbon
    c.poly([(2, 26), (8, 24), (10, 28), (5, 30)], red)
    c.poly([(30, 26), (24, 24), (22, 28), (27, 30)], red)
    c.rect(12, 25, 8, 5, gold)
    c.glyph(13, 25, "M", ink, 1)
    c.outline(ink)
    return c


# ---------------------------------------------------------------------------
# Bot portraits
# ---------------------------------------------------------------------------

BOT_BASE = {
    "orb": {"base": "4D6BFE", "dark": "141A3A", "light": "9CB0FF", "accent": "7BE7FF"},
    "robot": {"base": "10A37F", "dark": "0D2B24", "light": "7FE5C8", "accent": "C8FFF0"},
    "hood": {"base": "D97757", "dark": "2B1A14", "light": "F3B08C", "accent": "FFD8A8"},
    "cat": {"base": "FF2D95", "dark": "2A0E20", "light": "FF9CCB", "accent": "FFD1E8"},
    "skull": {"base": "B8C0CC", "dark": "171A21", "light": "EDF2F7", "accent": "FF6B6B"},
}

BOTS = [
    # id, display name, base, main, dark, light, accent, initial
    ("deepseek", "DeepSeek", "orb", "4D6BFE", "101538", "A9B8FF", "7BE7FF", "D"),
    ("gemini", "Gemini", "orb", "8AB4F8", "14213D", "D6E4FF", "FFE08A", "G"),
    ("chatgpt", "ChatGPT", "robot", "10A37F", "0B2B24", "8AF0D2", "E7FFF8", "C"),
    ("claude", "Claude", "hood", "D97757", "2B1A14", "F7C2A2", "FFE2B8", "C"),
    ("grok", "Grok", "skull", "B8C0CC", "101217", "F5F8FC", "FF5C6C", "G"),
    ("copilot", "Copilot", "cat", "00A4EF", "062539", "8BDCFF", "C9F4FF", "C"),
    ("mistral", "Mistral", "robot", "FF5A1F", "331106", "FFB38A", "FFE0A3", "M"),
    ("gigachat", "GigaChat", "orb", "21A038", "0A2510", "8BEE9B", "E7FFB0", "G"),
    ("alice", "Alice AI", "cat", "FF2D95", "2A0E20", "FFA8D4", "FFE1F0", "A"),
    ("qwen", "Qwen", "orb", "615CED", "161238", "B4AFFF", "8FF4FF", "Q"),
    ("llama", "Llama", "hood", "F5C518", "332800", "FFE886", "FFF3B8", "L"),
    ("perplexity", "Perplexity", "orb", "20808D", "07272A", "83DDE4", "B9FFF5", "P"),
    ("kimi", "Kimi", "robot", "FF6B6B", "361111", "FFB8B8", "FFE0B8", "K"),
    ("nova", "Nova", "cat", "FF7AB6", "351024", "FFC0DA", "FFE3B0", "N"),
    ("phi", "Phi", "robot", "A7B0BE", "1B1F27", "E4EAF2", "B9E7FF", "P"),
    ("gemma", "Gemma", "hood", "7CB342", "1B2A0E", "C7F08F", "F0FFB8", "G"),
    ("falcon", "Falcon", "skull", "C9A227", "2A2104", "F3D979", "FFD27A", "F"),
    ("yi", "Yi", "orb", "22D3EE", "062A31", "9BF3FF", "E7FFB0", "Y"),
    ("orion", "Orion", "hood", "6D5EF8", "15113A", "B9B0FF", "8FF4FF", "O"),
    ("system", "SYSTEM", "skull", "C0392B", "210806", "F08C80", "FFCD7A", "S"),
]


def bot_portrait(base: str, main: str, dark: str, light: str, accent: str, initial: str) -> Canvas:
    c = Canvas(24, 8)
    ink = c.add("05060A")
    base_c = c.add(main)
    dark_c = c.add(dark)
    light_c = c.add(light)
    accent_c = c.add(accent)
    eye = c.add("FFFFFF")
    eye2 = c.add("101018")
    glow = c.add(blend(main, "FFFFFF", 0.45))

    if base == "orb":
        c.ellipse(12, 12, 8.8, 8.8, dark_c)
        c.ellipse(12, 12, 7.4, 7.4, base_c)
        c.ellipse(10.4, 10.2, 4.2, 4.2, light_c)
        c.ellipse(12, 13, 5.8, 5.2, base_c)
        c.ring(12, 12, 11, 4.2, 1.0, accent_c)
        c.line(2, 12, 5, 12, accent_c)
        c.line(19, 12, 22, 12, accent_c)
        c.ellipse(9.2, 12, 1.6, 1.2, eye)
        c.ellipse(14.8, 12, 1.6, 1.2, eye)
        c.px(9, 12, eye2)
        c.px(15, 12, eye2)
        c.line(9, 16, 15, 16, eye2)
        c.px(10, 10, glow)
        c.px(11, 9, glow)
    elif base == "robot":
        # antenna
        c.line(12, 0, 12, 4, light_c)
        c.ellipse(12, 1.5, 1.8, 1.8, accent_c)
        # head
        c.rect(3, 4, 18, 15, ink)
        c.rect(4, 5, 16, 13, base_c)
        c.rect(4, 5, 16, 4, light_c)
        c.rect(5, 6, 14, 2, base_c)
        # ears
        c.rect(1, 9, 3, 5, dark_c)
        c.rect(20, 9, 3, 5, dark_c)
        # visor
        c.rect(6, 9, 12, 5, eye2)
        c.rect(7, 10, 10, 3, dark_c)
        c.rect(8, 11, 2, 2, accent_c)
        c.rect(14, 11, 2, 2, accent_c)
        c.px(9, 11, eye)
        c.px(15, 11, eye)
        # mouth
        for x in (8, 10, 12, 14, 16):
            c.px(x, 15, light_c)
        # shoulders
        c.rect(5, 20, 14, 3, dark_c)
        c.rect(7, 21, 10, 2, base_c)
    elif base == "hood":
        # hood silhouette
        c.poly([(12, 1), (21, 8), (21, 18), (18, 23), (6, 23), (3, 18), (3, 8)], ink)
        c.poly([(12, 2), (19, 8), (20, 17), (17, 22), (7, 22), (4, 17), (4, 8)], dark_c)
        c.poly([(12, 3), (18, 9), (18, 16), (16, 20), (8, 20), (6, 16), (6, 9)], base_c)
        c.poly([(12, 5), (16, 10), (16, 15), (14, 18), (10, 18), (8, 15), (8, 10)], ink)
        c.ellipse(9.4, 12, 1.5, 1.0, accent_c)
        c.ellipse(14.6, 12, 1.5, 1.0, accent_c)
        c.px(9, 12, eye)
        c.px(15, 12, eye)
        # collar
        c.poly([(4, 21), (8, 18), (12, 21), (16, 18), (20, 21), (19, 24), (5, 24)], ink)
        c.line(8, 19, 12, 22, light_c)
        c.line(16, 19, 12, 22, light_c)
    elif base == "cat":
        # ears
        c.poly([(4, 8), (5, 1), (11, 6)], ink)
        c.poly([(20, 8), (19, 1), (13, 6)], ink)
        c.poly([(5.5, 6), (6, 3), (9.5, 6)], base_c)
        c.poly([(18.5, 6), (18, 3), (14.5, 6)], base_c)
        # head
        c.ellipse(12, 12, 9.2, 7.8, ink)
        c.ellipse(12, 12, 8.2, 6.8, base_c)
        c.ellipse(10.5, 10.5, 5.2, 4.2, light_c)
        # visor
        c.rect(6, 10, 12, 4, eye2)
        c.rect(7, 11, 4, 2, accent_c)
        c.rect(13, 11, 4, 2, accent_c)
        c.px(8, 11, eye)
        c.px(14, 11, eye)
        # nose / whiskers
        c.px(12, 15, accent_c)
        c.px(11, 16, dark_c)
        c.px(13, 16, dark_c)
        c.line(3, 14, 6, 15, light_c)
        c.line(3, 17, 6, 16, light_c)
        c.line(21, 14, 18, 15, light_c)
        c.line(21, 17, 18, 16, light_c)
    else:  # skull
        c.ellipse(12, 10, 8.8, 8.2, ink)
        c.ellipse(12, 9.8, 7.8, 7.2, light_c)
        c.ellipse(12, 11.5, 6.0, 5.0, base_c)
        # jaw
        c.rect(7, 15, 10, 5, light_c)
        c.rect(8, 19, 8, 3, base_c)
        c.rect(9, 20, 1, 2, ink)
        c.rect(12, 20, 1, 2, ink)
        c.rect(15, 20, 1, 2, ink)
        # eyes
        c.ellipse(9, 10, 2.3, 2.0, ink)
        c.ellipse(15, 10, 2.3, 2.0, ink)
        c.px(9, 10, accent_c)
        c.px(15, 10, accent_c)
        c.px(9, 9, accent_c)
        c.px(15, 9, accent_c)
        # crack
        c.line(12, 4, 11, 7, dark_c)
        c.line(11, 7, 13, 8, dark_c)
        c.line(8, 16, 10, 18, dark_c)
    # initial badge
    c.rect(16, 18, 8, 7, ink)
    c.rect(17, 19, 6, 5, dark_c)
    c.rect(17, 19, 6, 1, base_c)
    c.glyph(18, 19, initial, accent_c, 1)
    c.outline(ink)
    return c


def blend(a: str, b: str, t: float) -> str:
    a = a.lstrip("#")
    b = b.lstrip("#")
    out = []
    for i in range(0, 6, 2):
        av = int(a[i : i + 2], 16)
        bv = int(b[i : i + 2], 16)
        out.append(f"{round(av + (bv - av) * t):02X}")
    return "".join(out)


def compile_roles() -> None:
    for name, fn in [
        ("mafia", mafia_icon),
        ("sheriff", sheriff_icon),
        ("civilian", civilian_icon),
        ("doctor", doctor_icon),
        ("assassin", assassin_icon),
        ("jester", jester_icon),
    ]:
        canvas = fn()
        canvas.save(OUT_ROLES / f"{name}.png", OUT_ASCL / f"role-{name}.asc")
        print("role", name, "->", OUT_ROLES / f"{name}.png")


def compile_bots() -> None:
    for bot_id, _, base, main, dark, light, accent, initial in BOTS:
        canvas = bot_portrait(base, main, dark, light, accent, initial)
        canvas.save(OUT_BOTS / f"{bot_id}.png", OUT_ASCL / f"bot-{bot_id}.asc")
    print("bots:", len(BOTS))


def compile_brand() -> None:
    canvas = brand_icon()
    png = OUT_BRAND / "icon-512.png"
    canvas.save(png, OUT_ASCL / "brand.asc")
    image = Image.open(png).convert("RGBA")
    for size in (192, 180, 64, 32):
        image.resize((size, size), Image.Resampling.NEAREST).save(OUT_BRAND / f"icon-{size}.png")
    image.save(ROOT / "favicon.png")
    print("brand ->", png, "sizes 512/192/180/64/32")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true", help="open generated images")
    args = parser.parse_args()
    if not ASCL.exists():
        raise SystemExit(f"ASCL compiler not found: {ASCL}")
    if not shutil.which("python"):
        raise SystemExit("python is not in PATH")
    OUT_ASCL.mkdir(parents=True, exist_ok=True)
    compile_roles()
    compile_bots()
    compile_brand()
    print("done")


if __name__ == "__main__":
    main()
