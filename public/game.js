'use strict';
var game = {};

function htmlEncode(str) {
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

$(window).load(function() {
    if (window.localStorage && window.localStorage.getItem('name')) {
        init(window.localStorage.getItem('name'));
    } else {
        $('#loading').hide();
        $('#login').fadeIn();
    }

    game.start = function(event) {
        event.preventDefault();
        var name = $('#name').val();
        if (name && name.length > 2 && name.length < 50) {
            var remember = $('#remember').val();
            if (remember === 'on' && window.localStorage) {
                window.localStorage.setItem('name', name);
            }

            if (window.ga) {
                ga('send', {
                    hitType: 'event',
                    eventCategory: 'Lobby',
                    eventAction: 'signIn'
                });
            }

            init(name);
        } else {
            $.bootstrapGrowl('Invalid name, length must be greater than 2 and less than 50.', {type: 'danger'});
        }
    };
});

function init(name) {
    var loaded = false;

    $('#login').hide();
    $('#loading').fadeIn();

    var socket = io(window.href, {
        query: 'name=' + name
    });
    var lobbyState = {};
    var gameState = {};
    var lastGameState = {};
    var userState = {};
    var teamColor = null;
    var selected = null;
    socket.on('connection', function () {
        console.log('Websocket connected.');
    });

    socket.on('disconnect', function() {
        console.log('Websocket disconnected.');
        game.addChat(0, 'Server', 'Disconnected from server.');
    });

    var teams = {
        1: 'red',
        2: 'black',
        3: 'blue',
        4: 'green'
    };

    socket.on('userState', function (newUserState) {
        userState = newUserState;
        teamColor = teams[userState.team];

        $('#userTeam').html('You are on the <b style="color:' + teamColor + ';">' + teamColor + '</b> team.');
    });

    game.quit = function() {
        window.location.reload();

        if (window.ga) {
            ga('send', {
                hitType: 'event',
                eventCategory: 'Game',
                eventAction: 'disconnect'
            });
        }
    };

    game.signOut = function() {
        if (window.localStorage) {
            window.localStorage.clear();
        }

        if (window.ga) {
            ga('send', {
                hitType: 'event',
                eventCategory: 'Lobby',
                eventAction: 'signOut'
            });
        }

        $('#game').hide();
        window.location.reload();
    };

    game.selectChecker = function (val, x, y) {
        if (val === 0) {
            if (selected) {
                socket.emit('move', {
                    selected: selected,
                    to: {
                        x: x,
                        y: y
                    }
                });

                selected = null;
                game.redrawBoard();
            }
        } else {
            if (gameState.teamTurn === userState.team && val === userState.team) {
                selected = {
                    x: x,
                    y: y
                };
                game.redrawBoard();
            }
        }
    };

    game.redrawBoard = function () {
        var html = '<table>';
        var scores = {};
        for (var y = 0; y < gameState.board.length; y++) {
            var row = gameState.board[y];
            html += '<tr>';
            for (var x = 0; x < row.length; x++) {
                var val = row[x];

                if (scores[val]) {
                    scores[val]++;
                } else {
                    scores[val] = 1;
                }

                html += '<td onclick="game.selectChecker(' + val + ',' + x + ',' + y + ')">';
                if (val === 0) {
                    html += '<div class="checker">&nbsp;</div>';
                } else {
                    var selectedClass = '';
                    if (gameState.teamTurn === userState.team && val === userState.team) {
                        selectedClass += ' clickable';
                    }
                    if (selected && x === selected.x && y === selected.y) {
                        selectedClass += ' selected';
                    }
                    html += '<div id="checker-' + x + '-' + y + '" class="checker ' + selectedClass + ' checker-' + val + '">&nbsp;</div>';
                }
                html += '</td>';
            }
            html += '</tr>';
        }
        html += '</table>';
        $('#gameBoard').html(html);

        var scoreArray = [];
        for (var i = 0; i < Object.keys(scores).length; i++) {
            var key = Object.keys(scores)[i];
            var score = scores[key];
            if (key > 0) {
                scoreArray.push({
                    team: key,
                    score: score
                });
            }
        }

        scoreArray.sort(function (a, b) {
            return b.score - a.score;
        });

        var scoreHtml = '<ol>';
        for (var j = 0; j < scoreArray.length; j++) {
            var score = scoreArray[j];
            var scoreColor = teams[score.team];

            var userList = '';
            for (var k = 0; k < Object.keys(gameState.users).length; k++) {
                var user = gameState.users[Object.keys(gameState.users)[k]];
                if (user.team == score.team) {
                    userList += htmlEncode(user.name);
                }
            }

            scoreHtml += '<li><h4 style="color:' + scoreColor + ';">' + scoreColor + ': ' + score.score + ' - ' + userList + '</h4></li>';
        }
        scoreHtml += '</ol>';
        $('#scores').html(scoreHtml);
    };

    game.sendChat = function(event) {
        event.preventDefault();
        var chatbox =  $('#chatbox');
        socket.emit('chat', chatbox.val());
        chatbox.val('');

        if (window.ga) {
            ga('send', {
                hitType: 'event',
                eventCategory: 'Game',
                eventAction: 'sendChat'
            });
        }
    };

    game.addChat = function(color, name, message) {
        var chat = $('#chat');
        chat.append('<div><b style="color:' + color + ';">' + htmlEncode(name) + '</b><b>:</b> ' + message + '</div>');
        chat.scrollTop(chat[0].scrollHeight);
    };

    socket.on('winner', function (team) {
        var teamColor = teams[team];
        game.addChat(0, 'Server', 'Team <b style="color:' + teamColor + ';">' + teamColor + '</b> has won the game!');
        game.addChat(0, 'Server', 'Restarting the game in 10 seconds...');
    });

    socket.on('eliminated', function (team) {
        var teamColor = teams[team];
        game.addChat(0, 'Server', 'Team <b style="color:' + teamColor + ';">' + teamColor + '</b> was eliminated.');
    });

    socket.on('chat', function (data) {
        var color = teams[data.user.team];
        game.addChat(color, htmlEncode(data.user.name), htmlEncode(data.message));
    });

    socket.on('alert', function (message) {
        $.bootstrapGrowl(message, {type: 'danger'});
    });

    game.startNewGame = function() {
        $('#lobby').hide();
        $('#loading').fadeIn();

        socket.emit('newGame', {
            maxPlayers: $('#maxPlayers').val()
        });

        if (window.ga) {
            ga('send', {
                hitType: 'event',
                eventCategory: 'Lobby',
                eventAction: 'gameStart'
            });
        }
    };

    game.joinGame = function(id) {
        socket.emit('joinGame', id);
        if (window.ga) {
            ga('send', {
                hitType: 'event',
                eventCategory: 'Lobby',
                eventAction: 'gameJoin'
            });
        }
    };

    game.joinRandomGame = function() {
        socket.emit('joinRandomGame');
        if (window.ga) {
            ga('send', {
                hitType: 'event',
                eventCategory: 'Lobby',
                eventAction: 'gameJoinRandom'
            });
        }
    };

    game.redrawLobby = function() {
        $('#playerCount').html(lobbyState.clientCount);
        if (lobbyState.games.length) {
            var html = '';
            for (var i=0; i<lobbyState.games.length; i++) {
                var game = lobbyState.games[i];
                html += '<div class="well"><div style="margin-top:5px;" class="pull-right">' +
                    '<button onclick="game.joinGame(\'' + game.id + '\')" class="btn btn-sm btn-primary" ' + (game.players >= game.maxPlayers ? 'disabled="disabled"' : '') + '>Join Game</button></div> ' +
                    '<h4>' + htmlEncode(game.name) + ' (' + game.players + '/' + game.maxPlayers + ')</h4></div>';
            }
            $('#lobbyGames').html(html);
        } else {
            $('#lobbyGames').html('<h3 class="text-center">No games currently active.</h3>');
        }
    };

    socket.on('lobbyState', function (newLobbyState) {
        $('#body').css('background-color', '#FFFFFF');
        $('#game').hide();
        $('#loading').hide();
        $('#lobby').fadeIn();
        lobbyState = newLobbyState;
        game.redrawLobby();
        loaded = false;
    });

    socket.on('gameState', function (newGameState) {
        if (!loaded) {
            loaded = true;
            $('#loading').hide();
            $('#lobby').hide();
            $('#game').fadeIn();
            $('#chat').html('');
        }

        selected = null;
        lastGameState = gameState;
        gameState = newGameState;

        game.redrawBoard();

        var cellSize = 50;
        if (gameState.move) {
            var checker = $('#checker-' + gameState.move.to.x + '-' + gameState.move.to.y);
            var oldPos = {
                x: gameState.move.from.x * cellSize,
                y: gameState.move.from.y * cellSize
            };
            var newPos = {
                x: gameState.move.to.x * cellSize,
                y: gameState.move.to.y * cellSize
            };

            checker.css({
                position: 'relative',
                top: oldPos.y - newPos.y,
                left: oldPos.x - newPos.x
            });

            checker.animate({
                position: 'relative',
                top: 0,
                left: 0
            });
        }


        if (gameState.teamTurn === userState.team) {
            $('#body').css('background-color', '#D3FFD3');
            $('#teamTurn').html('It is <b style="color:' + teamColor + ';">your</b> team\'s turn.');
        } else {
            $('#body').css('background-color', '#FFFFFF');
            var turnColor = teams[gameState.teamTurn];
            $('#teamTurn').html('It is the <b style="color:' + turnColor + ';">' + turnColor + '</b> team\'s turn.');
        }
    });
}