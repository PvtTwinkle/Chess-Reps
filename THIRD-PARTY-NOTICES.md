# Third-Party Notices

Chessstack uses the following third-party data and assets. Thank you to these
projects and their contributors.

---

## Chessmont Dataset

- **Source**: https://www.kaggle.com/datasets/chessmontdb/chessmont-big-dataset
- **Creator**: ChessmontDB (https://www.kaggle.com/chessmontdb)
- **License**: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- **Tool**: https://github.com/Chessmont/ChessDatasetGenerator

**What we use**: Master game statistics derived from ~21.5 million games (ELO >= 2500).

**Modifications**: The raw PGN data was parsed, positions were normalized to
4-field FEN format, and move statistics (wins, draws, losses, game count) were
aggregated per position-move pair. Only positions with 5 or more games were
retained, resulting in ~8.8 million rows stored in the `chessmont_moves` table.

---

## Lichess Puzzle Database

- **Source**: https://database.lichess.org/#puzzles
- **Creator**: [Lichess](https://lichess.org)
- **License**: [CC0 1.0 (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/)

**What we use**: Puzzles filtered by opening tag to match the user's repertoire.

---

## Lichess Chess Openings

- **Source**: https://github.com/lichess-org/chess-openings
- **Creator**: [Lichess](https://lichess.org)
- **License**: [CC0 1.0 (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/)

**What we use**: ECO codes, opening names, and move sequences used to populate
the `eco_opening` and `book_move` tables.

---

## Lichess Sound Assets

- **Source**: https://github.com/lichess-org/lila
- **Creator**: [Lichess](https://lichess.org)
- **License**: [AGPL v3+](https://www.gnu.org/licenses/agpl-3.0.html)

**What we use**: Sound effects for move, capture, correct, and incorrect events
(`move.mp3`, `capture.mp3`, `correct.mp3`, `incorrect.mp3`).
