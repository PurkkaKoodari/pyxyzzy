"""
This script converts the pyx.sqlite database in ajanata's PretendYoureXyzzy repository to the format used by pyXyzzy.

This includes converting the HTML formatting used by PYX to pyXyzzy's Markdown-like format and then inserting the data
into pyXyzzy's database schema.

pyXyzzy stores each copy of the cards separately, since PYX's card database will still take less than a megabyte. This
allows us not to use a many-to-many relation in the database. Also, we will be deduplicating cards from other sources
(read: Cardcast) by text, so deduplication of local cards on the database level is unnecessary.
"""
import html
import sqlite3
import sys
from os import unlink
from os.path import exists
from re import findall, DOTALL
from uuid import uuid4

from pyxyzzy.database import db_connection, DbCardPack, DbWhiteCard, DbBlackCard


def usage():
    print("Usage: python3 convert_cards.py pyx.sqlite cards.db")
    sys.exit(1)


def convert_card(text: str, black: bool):
    tokens = findall(r"</?\w+>|&#?\w+;|\n|[ \t]+|_{4}|.", text, DOTALL)
    output = ""
    for token in tokens:
        if token == "____" and black:  # markers for blanks
            output += "\\_"
            continue
        if len(token) > 1:
            if token.isspace():  # collapse spaces
                token = " "
            elif token[0] == "&":  # html entities
                token = html.unescape(token)
            elif token[0] == "<":  # html tags
                tag = token.strip("</>")
                if tag == "br":
                    output += "\n"
                    continue
                if tag != "i":
                    raise ValueError(f"html tag {token} not allowed")
                output += "\\"
                output += tag.lower() if token[1] == "/" else tag.upper()
                continue
            elif token != "____":
                raise AssertionError("invalid multi-char token")
        if token == "\\":  # escape backslashes
            output += "\\\\"
        elif token == "\n":  # pass newlines as-is
            output += "\n"
        elif token.isspace():  # collapse all other whitespace
            output += " "
        else:  # regular characters
            output += token
    return output


if len(sys.argv) != 3:
    usage()

_, infile, outfile = sys.argv

if exists(outfile):
    print(f"Deleting existing {outfile}")
    unlink(outfile)

indb = sqlite3.connect(infile)

db_connection.init(outfile, pragmas={
    "foreign_keys": 1,
    "ignore_check_constraints": 0,
    "synchronous": 0,  # as we are rewriting the db from scratch anyway, corruption does not matter
})

db_connection.connect()
print("Creating database")
db_connection.create_tables([DbCardPack, DbWhiteCard, DbBlackCard])

with db_connection.atomic():
    pack_cursor = indb.execute("""
        SELECT card_set.id, card_set.name
        FROM card_set
        ORDER BY weight ASC
    """)

    for pack_id, pack_name in pack_cursor.fetchall():
        print(f"Processing {pack_name}")

        # determine pack watermark by finding a card unique to this pack
        query = """
            SELECT set_cards.watermark
            FROM (
                SELECT inner_cards.id, inner_cards.watermark
                FROM black_cards inner_cards
                INNER JOIN card_set_black_card inner_rel on inner_cards.id = inner_rel.black_card_id
                WHERE inner_rel.card_set_id = ?
            ) set_cards
            INNER JOIN card_set_black_card outer_rel ON outer_rel.black_card_id = set_cards.id
            GROUP BY set_cards.id
            HAVING COUNT() = 1
            LIMIT 1
        """
        cursor = indb.execute(query, [pack_id])
        row = cursor.fetchone()
        if row is None:
            cursor.execute(query.replace("black", "white"), [pack_id])
            row = cursor.fetchone()
        if row is None:
            raise ValueError(f"pack {pack_name} has no unique cards, unable to determine a watermark")
        watermark, = row

        print(f"Watermark {watermark}")
        pack = DbCardPack.create(uuid=uuid4(), name=pack_name, watermark=watermark)

        white_cursor = indb.execute("""
            SELECT white_cards.text
            FROM white_cards
            INNER JOIN card_set_white_card ON card_set_white_card.white_card_id = white_cards.id
            WHERE card_set_white_card.card_set_id = ?
        """, [pack_id])

        for text, in white_cursor.fetchall():
            DbWhiteCard.create(pack=pack, uuid=uuid4(), text=convert_card(text, black=False))

        black_cursor = indb.execute("""
            SELECT black_cards.text, black_cards.draw, black_cards.pick
            FROM black_cards
            INNER JOIN card_set_black_card ON card_set_black_card.black_card_id = black_cards.id
            WHERE card_set_black_card.card_set_id = ?
        """, [pack_id])

        for text, draw_count, pick_count in black_cursor.fetchall():
            DbBlackCard.create(pack=pack, uuid=uuid4(), text=convert_card(text, black=True),
                               draw_count=draw_count, pick_count=pick_count)

db_connection.close()
indb.close()
