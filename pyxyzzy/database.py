from peewee import Model, TextField, UUIDField, SqliteDatabase, ForeignKeyField, CharField, IntegerField

db_connection = SqliteDatabase(None, autoconnect=False)


class BaseModel(Model):
    class Meta:
        database = db_connection


class DbCardPack(BaseModel):
    uuid = UUIDField(unique=True)
    name = CharField(max_length=64)
    watermark = CharField(max_length=10)


class DbWhiteCard(BaseModel):
    pack = ForeignKeyField(DbCardPack, backref="white_cards", on_delete="CASCADE", on_update="CASCADE")
    uuid = UUIDField(unique=True)
    text = TextField()


class DbBlackCard(BaseModel):
    pack = ForeignKeyField(DbCardPack, backref="black_cards", on_delete="CASCADE", on_update="CASCADE")
    text = TextField()
    pick_count = IntegerField()
    draw_count = IntegerField()
