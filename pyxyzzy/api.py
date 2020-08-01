from enum import Enum


class ApiAction(Enum):
    authenticate = "authenticate"
    log_out = "log_out"
    game_list = "game_list"
    create_game = "create_game"
    join_game = "join_game"
    leave_game = "leave_game"
    kick_player = "kick_player"
    game_options = "game_options"
    start_game = "start_game"
    stop_game = "stop_game"
    play_white = "play_white"
    choose_winner = "choose_winner"
    chat = "chat"
