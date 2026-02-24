-- Seed: ECO (Encyclopaedia of Chess Openings) codes
--
-- Each row maps a board position (FEN) to an ECO code and opening name.
-- The FEN strings use Chess.js conventions: the en passant square is
-- omitted (shown as '-') unless an enemy pawn is actually adjacent and
-- could legally capture. This matches the FENs stored everywhere else
-- in this database.
--
-- Coverage: ~90 key positions across all five ECO sections (A–E),
-- spanning the most commonly encountered opening names.

-- ─────────────────────────────────────────────────────────────────────────────
-- A: Irregular and Flank Openings (A00–A99)
-- ─────────────────────────────────────────────────────────────────────────────

-- A00 — Uncommon first moves (catch-all; we use the starting position as anchor)
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A00',
    'Uncommon Opening',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
);
--> statement-breakpoint
-- A01 — Nimzo-Larsen Attack: 1.b3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A01',
    'Nimzo-Larsen Attack',
    'rnbqkbnr/pppppppp/8/8/8/1P6/P1PPPPPP/RNBQKBNR b KQkq - 0 1'
);
--> statement-breakpoint
-- A02 — Bird''s Opening: 1.f4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A02',
    'Bird''s Opening',
    'rnbqkbnr/pppppppp/8/8/5P2/8/PPPPP1PP/RNBQKBNR b KQkq - 0 1'
);
--> statement-breakpoint
-- A04 — Reti Opening: 1.Nf3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A04',
    'Reti Opening',
    'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1'
);
--> statement-breakpoint
-- A06 — Reti: 1.Nf3 d5 2.b3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A06',
    'Reti Opening, Nimzo-Larsen Variation',
    'rnbqkbnr/ppp1pppp/8/3p4/8/1P3N2/P1PPPPPP/RNBQKB1R b KQkq - 0 2'
);
--> statement-breakpoint
-- A10 — English Opening: 1.c4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A10',
    'English Opening',
    'rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1'
);
--> statement-breakpoint
-- A20 — English Opening: 1.c4 e5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A20',
    'English Opening, King''s English Variation',
    'rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- A30 — English: Symmetrical Variation 1.c4 c5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A30',
    'English Opening, Symmetrical Variation',
    'rnbqkbnr/pp1ppppp/8/2p5/2P5/8/PP1PPPPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- A40 — Queen''s Pawn Game: 1.d4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A40',
    'Queen''s Pawn Game',
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'
);
--> statement-breakpoint
-- A45 — Trompowsky Attack: 1.d4 Nf6 2.Bg5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A45',
    'Trompowsky Attack',
    'rnbqkb1r/pppppppp/5n2/6B1/3P4/8/PPP1PPPP/RN1QKBNR b KQkq - 2 2'
);
--> statement-breakpoint
-- A51 — Budapest Gambit: 1.d4 Nf6 2.c4 e5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A51',
    'Budapest Gambit',
    'rnbqkb1r/pppp1ppp/5n2/4p3/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3'
);
--> statement-breakpoint
-- A57 — Benko Gambit: 1.d4 Nf6 2.c4 c5 3.d5 b5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A57',
    'Benko Gambit',
    'rnbqkb1r/p2ppppp/5n2/1ppP4/2P5/8/PP2PPPP/RNBQKBNR w KQkq - 0 4'
);
--> statement-breakpoint
-- A60 — Benoni Defence: 1.d4 Nf6 2.c4 c5 3.d5 e6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A60',
    'Benoni Defence',
    'rnbqkb1r/pp1p1ppp/4pn2/2pP4/2P5/8/PP2PPPP/RNBQKBNR w KQkq - 0 4'
);
--> statement-breakpoint
-- A80 — Dutch Defence: 1.d4 f5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'A80',
    'Dutch Defence',
    'rnbqkbnr/ppppp1pp/8/5p2/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- B: Semi-Open Games (B00–B99)
-- ─────────────────────────────────────────────────────────────────────────────

-- B00 — King''s Pawn Game: 1.e4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B00',
    'King''s Pawn Game',
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
);
--> statement-breakpoint
-- B01 — Scandinavian Defence: 1.e4 d5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B01',
    'Scandinavian Defence',
    'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- B02 — Alekhine''s Defence: 1.e4 Nf6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B02',
    'Alekhine''s Defence',
    'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2'
);
--> statement-breakpoint
-- B03 — Alekhine''s Defence: 1.e4 Nf6 2.e5 Nd5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B03',
    'Alekhine''s Defence, Four Pawns Attack',
    'rnbqkb1r/pppppppp/8/3nP3/8/8/PPPP1PPP/RNBQKBNR w KQkq - 1 3'
);
--> statement-breakpoint
-- B06 — Modern Defence: 1.e4 g6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B06',
    'Modern Defence',
    'rnbqkbnr/pppppp1p/6p1/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- B07 — Pirc Defence: 1.e4 d6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B07',
    'Pirc Defence',
    'rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- B08 — Pirc Defence: 1.e4 d6 2.d4 Nf6 3.Nc3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B08',
    'Pirc Defence, Classical Variation',
    'rnbqkb1r/ppp1pppp/3p1n2/8/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 2 3'
);
--> statement-breakpoint
-- B10 — Caro-Kann Defence: 1.e4 c6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B10',
    'Caro-Kann Defence',
    'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- B13 — Caro-Kann: Exchange Variation 1.e4 c6 2.d4 d5 3.exd5 cxd5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B13',
    'Caro-Kann Defence, Exchange Variation',
    'rnbqkbnr/pp2pppp/8/3p4/3P4/8/PPP2PPP/RNBQKBNR w KQkq - 0 4'
);
--> statement-breakpoint
-- B15 — Caro-Kann: 1.e4 c6 2.d4 d5 3.Nc3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B15',
    'Caro-Kann Defence, Main Line',
    'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 1 3'
);
--> statement-breakpoint
-- B17 — Caro-Kann: Steinitz Variation 1.e4 c6 2.d4 d5 3.Nd2
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B17',
    'Caro-Kann Defence, Steinitz Variation',
    'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPPN1PPP/R1BQKBNR b KQkq - 1 3'
);
--> statement-breakpoint
-- B20 — Sicilian Defence: 1.e4 c5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B20',
    'Sicilian Defence',
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- B22 — Sicilian: Alapin Variation 1.e4 c5 2.c3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B22',
    'Sicilian Defence, Alapin Variation',
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/2P5/PP1P1PPP/RNBQKBNR b KQkq - 0 2'
);
--> statement-breakpoint
-- B23 — Sicilian: Grand Prix Attack 1.e4 c5 2.Nc3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B23',
    'Sicilian Defence, Grand Prix Attack',
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 2'
);
--> statement-breakpoint
-- B27 — Sicilian: 1.e4 c5 2.Nf3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B27',
    'Sicilian Defence, Open Variation',
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'
);
--> statement-breakpoint
-- B30 — Sicilian: 1.e4 c5 2.Nf3 Nc6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B30',
    'Sicilian Defence, Old Sicilian',
    'r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
);
--> statement-breakpoint
-- B40 — Sicilian: 1.e4 c5 2.Nf3 e6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B40',
    'Sicilian Defence, Four Knights Variation',
    'rnbqkbnr/pp1p1ppp/4p3/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3'
);
--> statement-breakpoint
-- B50 — Sicilian: 1.e4 c5 2.Nf3 d6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B50',
    'Sicilian Defence',
    'rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3'
);
--> statement-breakpoint
-- B54 — Sicilian: 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B54',
    'Sicilian Defence, Dragon/Classical setup',
    'rnbqkbnr/pp2pppp/3p4/8/3NP3/8/PPP2PPP/RNBQKB1R b KQkq - 0 4'
);
--> statement-breakpoint
-- B56 — Sicilian: 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B56',
    'Sicilian Defence, Classical Variation',
    'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/8/PPP2PPP/RNBQKB1R w KQkq - 1 5'
);
--> statement-breakpoint
-- B70 — Sicilian: Dragon 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 g6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B70',
    'Sicilian Defence, Dragon Variation',
    'rnbqkb1r/pp2pp1p/3p1np1/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6'
);
--> statement-breakpoint
-- B80 — Sicilian: Scheveningen 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 e6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B80',
    'Sicilian Defence, Scheveningen Variation',
    'rnbqkb1r/pp3ppp/3ppn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6'
);
--> statement-breakpoint
-- B90 — Sicilian: Najdorf 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B90',
    'Sicilian Defence, Najdorf Variation',
    'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6'
);
--> statement-breakpoint
-- B97 — Sicilian: Najdorf, Poisoned Pawn 5...a6 6.Bg5 e6 7.f4 Qb6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'B97',
    'Sicilian Defence, Najdorf, Poisoned Pawn Variation',
    'rnb1kb1r/1p3ppp/p2ppn2/6B1/3NPP2/2N5/PPP3PP/R2QKB1R b KQkq - 0 7'
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- C: Open Games and French (C00–C99)
-- ─────────────────────────────────────────────────────────────────────────────

-- C00 — French Defence: 1.e4 e6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C00',
    'French Defence',
    'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- C01 — French: Exchange Variation
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C01',
    'French Defence, Exchange Variation',
    'rnbqkbnr/ppp2ppp/8/3p4/3P4/8/PPP2PPP/RNBQKBNR w KQkq - 0 4'
);
--> statement-breakpoint
-- C02 — French: Advance Variation 1.e4 e6 2.d4 d5 3.e5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C02',
    'French Defence, Advance Variation',
    'rnbqkbnr/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq - 0 3'
);
--> statement-breakpoint
-- C10 — French: 1.e4 e6 2.d4 d5 3.Nc3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C10',
    'French Defence, Paulsen Variation',
    'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 1 3'
);
--> statement-breakpoint
-- C11 — French: Classical Variation 1.e4 e6 2.d4 d5 3.Nc3 Nf6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C11',
    'French Defence, Classical Variation',
    'rnbqkb1r/ppp2ppp/4pn2/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR w KQkq - 2 4'
);
--> statement-breakpoint
-- C14 — French: Classical, Steinitz Variation
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C14',
    'French Defence, Classical, Steinitz Variation',
    'rnbqkb1r/ppp2ppp/4pn2/3p2B1/3PP3/2N5/PPP2PPP/R2QKBNR b KQkq - 3 4'
);
--> statement-breakpoint
-- C18 — French: Winawer Variation 1.e4 e6 2.d4 d5 3.Nc3 Bb4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C18',
    'French Defence, Winawer Variation',
    'rnbqk1nr/ppp2ppp/4p3/3p4/1b1PP3/2N5/PPP2PPP/R1BQKBNR w KQkq - 2 4'
);
--> statement-breakpoint
-- C20 — King''s Pawn Game: 1.e4 e5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C20',
    'King''s Pawn Game',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- C21 — Centre Game: 1.e4 e5 2.d4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C21',
    'Centre Game',
    'rnbqkbnr/pppp1ppp/8/4p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 2'
);
--> statement-breakpoint
-- C23 — Bishop''s Opening: 1.e4 e5 2.Bc4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C23',
    'Bishop''s Opening',
    'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 2'
);
--> statement-breakpoint
-- C25 — Vienna Game: 1.e4 e5 2.Nc3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C25',
    'Vienna Game',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 2'
);
--> statement-breakpoint
-- C30 — King''s Gambit: 1.e4 e5 2.f4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C30',
    'King''s Gambit',
    'rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq - 0 2'
);
--> statement-breakpoint
-- C33 — King''s Gambit Accepted: 1.e4 e5 2.f4 exf4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C33',
    'King''s Gambit Accepted',
    'rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3'
);
--> statement-breakpoint
-- C40 — King''s Knight Opening: 1.e4 e5 2.Nf3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C40',
    'King''s Knight Opening',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'
);
--> statement-breakpoint
-- C41 — Philidor Defence: 1.e4 e5 2.Nf3 d6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C41',
    'Philidor Defence',
    'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3'
);
--> statement-breakpoint
-- C42 — Petrov''s Defence: 1.e4 e5 2.Nf3 Nf6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C42',
    'Petrov''s Defence',
    'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
);
--> statement-breakpoint
-- C44 — King''s Pawn Game: 1.e4 e5 2.Nf3 Nc6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C44',
    'King''s Pawn Game, Ponziani Opening',
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
);
--> statement-breakpoint
-- C45 — Scotch Game: 1.e4 e5 2.Nf3 Nc6 3.d4 exd4 4.Nxd4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C45',
    'Scotch Game',
    'r1bqkbnr/pppp1ppp/2n5/8/3NP3/8/PPP2PPP/RNBQKB1R b KQkq - 0 4'
);
--> statement-breakpoint
-- C47 — Four Knights: 1.e4 e5 2.Nf3 Nc6 3.Nc3 Nf6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C47',
    'Four Knights Game',
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4'
);
--> statement-breakpoint
-- C50 — Italian Game: 1.e4 e5 2.Nf3 Nc6 3.Bc4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C50',
    'Italian Game',
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
);
--> statement-breakpoint
-- C51 — Giuoco Piano: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C51',
    'Giuoco Piano',
    'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
);
--> statement-breakpoint
-- C55 — Two Knights: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C55',
    'Two Knights Defence',
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
);
--> statement-breakpoint
-- C60 — Ruy Lopez: 1.e4 e5 2.Nf3 Nc6 3.Bb5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C60',
    'Ruy Lopez',
    'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
);
--> statement-breakpoint
-- C61 — Ruy Lopez: Bird''s Defence 3...Nd4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C61',
    'Ruy Lopez, Bird''s Defence',
    'r1bqkbnr/pppp1ppp/8/1B2p3/3nP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
);
--> statement-breakpoint
-- C65 — Ruy Lopez: Berlin Defence 3...Nf6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C65',
    'Ruy Lopez, Berlin Defence',
    'r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
);
--> statement-breakpoint
-- C70 — Ruy Lopez: Morphy Defence 3...a6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C70',
    'Ruy Lopez, Morphy Defence',
    'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4'
);
--> statement-breakpoint
-- C80 — Ruy Lopez: Open Defence 3...a6 4.Ba4 Nf6 5.0-0 Nxe4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C80',
    'Ruy Lopez, Open Defence',
    'r1bqkb1r/1ppp1ppp/p1n5/4p3/B2Pn3/5N2/PPP2PPP/RNBQK2R w KQkq - 0 6'
);
--> statement-breakpoint
-- C84 — Ruy Lopez: Closed Defence 3...a6 4.Ba4 Nf6 5.0-0 Be7
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'C84',
    'Ruy Lopez, Closed Defence',
    'r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQR1K1 b kq - 3 6'
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- D: Closed and Semi-Closed Games (D00–D99)
-- ─────────────────────────────────────────────────────────────────────────────

-- D00 — Queen''s Pawn Game: 1.d4 d5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D00',
    'Queen''s Pawn Game',
    'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2'
);
--> statement-breakpoint
-- D02 — London System: 1.d4 d5 2.Nf3 Nf6 3.Bf4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D02',
    'London System',
    'rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/5N2/PPP1PPPP/RN1QKB1R b KQkq - 3 3'
);
--> statement-breakpoint
-- D05 — Colle System: 1.d4 d5 2.Nf3 Nf6 3.e3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D05',
    'Colle System',
    'rnbqkb1r/ppp1pppp/5n2/3p4/3P4/4PN2/PPP2PPP/RNBQKB1R b KQkq - 0 3'
);
--> statement-breakpoint
-- D06 — Queen''s Gambit: 1.d4 d5 2.c4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D06',
    'Queen''s Gambit',
    'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2'
);
--> statement-breakpoint
-- D10 — Slav Defence: 1.d4 d5 2.c4 c6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D10',
    'Slav Defence',
    'rnbqkbnr/pp2pppp/2p5/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3'
);
--> statement-breakpoint
-- D20 — Queen''s Gambit Accepted: 1.d4 d5 2.c4 dxc4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D20',
    'Queen''s Gambit Accepted',
    'rnbqkbnr/ppp1pppp/8/8/2pP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3'
);
--> statement-breakpoint
-- D30 — Queen''s Gambit Declined: 1.d4 d5 2.c4 e6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D30',
    'Queen''s Gambit Declined',
    'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3'
);
--> statement-breakpoint
-- D35 — QGD: Exchange Variation 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.cxd5 exd5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D35',
    'Queen''s Gambit Declined, Exchange Variation',
    'rnbqkb1r/ppp2ppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 5'
);
--> statement-breakpoint
-- D43 — Semi-Slav: 1.d4 d5 2.c4 c6 3.Nf3 Nf6 4.Nc3 e6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D43',
    'Semi-Slav Defence',
    'rnbqkb1r/pp3ppp/2p1pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 5'
);
--> statement-breakpoint
-- D50 — QGD: 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D50',
    'Queen''s Gambit Declined, Tartakower Variation',
    'rnbqkb1r/ppp2ppp/4pn2/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR b KQkq - 3 4'
);
--> statement-breakpoint
-- D70 — Grunfeld Defence: 1.d4 Nf6 2.c4 g6 3.Nc3 d5
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D70',
    'Grunfeld Defence',
    'rnbqkb1r/ppp1pp1p/5np1/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4'
);
--> statement-breakpoint
-- D80 — Grunfeld: Russian Variation
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D80',
    'Grunfeld Defence, Russian Variation',
    'rnbqkb1r/ppp1pp1p/5np1/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq - 1 4'
);
--> statement-breakpoint
-- D85 — Grunfeld: Exchange Variation
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'D85',
    'Grunfeld Defence, Exchange Variation',
    'rnbqkb1r/ppp1pp1p/6p1/3n4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 5'
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- E: Indian Defences (E00–E99)
-- ─────────────────────────────────────────────────────────────────────────────

-- E00 — Indian Game: 1.d4 Nf6 2.c4 e6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E00',
    'Indian Game, Queen''s Indian setup',
    'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3'
);
--> statement-breakpoint
-- E10 — Queen''s Indian: 1.d4 Nf6 2.c4 e6 3.Nf3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E10',
    'Queen''s Indian Defence',
    'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R b KQkq - 1 3'
);
--> statement-breakpoint
-- E12 — Queen''s Indian: 1.d4 Nf6 2.c4 e6 3.Nf3 b6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E12',
    'Queen''s Indian Defence, Main Line',
    'rnbqkb1r/p1pp1ppp/1p2pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 0 4'
);
--> statement-breakpoint
-- E20 — Nimzo-Indian: 1.d4 Nf6 2.c4 e6 3.Nc3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E20',
    'Nimzo-Indian Defence',
    'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq - 1 3'
);
--> statement-breakpoint
-- E40 — Nimzo-Indian: 1.d4 Nf6 2.c4 e6 3.Nc3 Bb4
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E40',
    'Nimzo-Indian Defence, Classical Variation',
    'rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4'
);
--> statement-breakpoint
-- E46 — Nimzo-Indian: 1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 4.e3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E46',
    'Nimzo-Indian Defence, Rubinstein Variation',
    'rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N1P3/PP3PPP/R1BQKBNR b KQkq - 0 4'
);
--> statement-breakpoint
-- E60 — King''s Indian Defence: 1.d4 Nf6 2.c4 g6
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E60',
    'King''s Indian Defence',
    'rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3'
);
--> statement-breakpoint
-- E70 — King''s Indian: 1.d4 Nf6 2.c4 g6 3.Nc3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E70',
    'King''s Indian Defence, Four Pawns Attack',
    'rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq - 1 3'
);
--> statement-breakpoint
-- E80 — King''s Indian: Samisch Variation 3...Bg7 4.e4 d6 5.f3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E80',
    'King''s Indian Defence, Samisch Variation',
    'rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N2P2/PP4PP/R1BQKBNR b KQkq - 0 5'
);
--> statement-breakpoint
-- E90 — King''s Indian: Classical Variation 3...Bg7 4.e4 d6 5.Nf3
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E90',
    'King''s Indian Defence, Classical Variation',
    'rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP3PPP/R1BQKB1R b KQkq - 1 5'
);
--> statement-breakpoint
-- E97 — King''s Indian: Classical, Mar del Plata Variation
INSERT OR IGNORE INTO eco_opening (code, name, fen) VALUES (
    'E97',
    'King''s Indian Defence, Classical, Mar del Plata Variation',
    'r1bq1rk1/ppp1ppbp/2np1np1/8/2PPP3/2N2N2/PP2BPPP/R1BQR1K1 b - - 4 7'
);
