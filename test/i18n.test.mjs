import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLanguage, translateText } from "../js/core/i18n.js";

test("language normalisation only accepts ru and en", () => {
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("ru"), "ru");
  assert.equal(normalizeLanguage("de"), "ru");
  assert.equal(normalizeLanguage(null), "ru");
});

test("translateText keeps Russian untouched in ru mode", () => {
  assert.equal(translateText("Комната закрыта.", "ru"), "Комната закрыта.");
  assert.equal(translateText("Ночь 3", "ru"), "Ночь 3");
});

test("translateText uses exact copy and preserves whitespace", () => {
  assert.equal(translateText("Комната закрыта.", "en"), "The room is closed.");
  assert.equal(translateText("  Комната закрыта.\n", "en"), "  The room is closed.\n");
  assert.equal(translateText("МАФИЯ", "en"), "MAFIA");
});

test("translateText handles dynamic day, phase and count fragments", () => {
  assert.equal(translateText("Ночь 3", "en"), "Night 3");
  assert.equal(translateText("День 4", "en"), "Day 4");
  assert.equal(translateText("Рассвет 2.", "en"), "Dawn 2.");
  assert.equal(translateText("5 игроков", "en"), "5 players");
  assert.equal(translateText("1 игрок", "en"), "1 player");
  assert.equal(translateText("3 комнат", "en"), "3 rooms");
  assert.equal(translateText("0/6 за 10 с", "en"), "0/6 in 10 s");
  assert.equal(translateText("д.4 14:23", "en"), "d.4 14:23");
  assert.equal(translateText("Комнат: 2", "en"), "rooms: 2");
  assert.equal(translateText("Мафия 2 · шериф 1 · доктор 1 · мирные 4", "en"), "Mafia 2 · sheriff 1 · doctor 1 · civilians 4");
});

test("translateText handles dynamic log lines with names", () => {
  assert.equal(translateText("Ночью погибли: Аня, Боб", "en"), "Killed at night: Аня, Боб");
  assert.equal(translateText("Говорит Аня", "en"), "Speaking: Аня");
  assert.equal(translateText("Последнее слово: Боб", "en"), "Last words: Боб");
  assert.equal(translateText("Проголосовали 3 из 5", "en"), "Voted 3 of 5");
});

test("translateText never invents text for unknown strings", () => {
  assert.equal(translateText("Совершенно новая строка", "en"), "Совершенно новая строка");
  assert.equal(translateText("", "en"), "");
  assert.equal(translateText(null, "en"), null);
});
