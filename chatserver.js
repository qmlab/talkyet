var https = require('https')

module.exports.start = function(server) {
  var io = require('socket.io')(server)

  // users which are currently connected to the chat
  var users = {};
  var sockets = {};
  console.log('TalkYet server started')

  io.sockets.on('connection', function (socket) {
    socket.addedUser = false;
    var address = socket.handshake.address;

    socket.on('get ip', function() {
      socket.emit('return ip', address)
    })

    // when the client emits 'add user', this listens and executes
    socket.on('add user', function (data) {
      // we store the username in the socket session for this client
      if (data.username && data.roomname) {
        if (data.username.indexOf('Guest_') === 0) {
          addUser(data)
        }
        else if (!!data.auth && data.auth.type === 'facebook') {
          var url = 'https://graph.facebook.com/me?access_token=' + data.auth.accessToken
          var req = https.get(url, function(res) {
            res.on('data', function(resultStr) {
              var result = JSON.parse(resultStr)
              if (result.verified && result.name === data.username) {
                addUser(data)
              }
              else {
                console.error('server-side access token verification failed for data:' + data.username + ' | type:' + data.auth.type + ' | access_token:' + data.auth.accessToken)
                socket.emit('login error', {
                  msg: 'login verification failed'
                })
              }
            })
          })

          req.end()

          req.on('error', function(e) {
            console.error(e)
            socket.emit('login error', {
              msg: 'failed to verify facebook login info'
            })
          })
        }
        else {
          socket.emit('login error', {
            msg: 'please re-login'
          })
        }
      }
      else {
        socket.emit('login error', {
          msg: 'empty username or roomname'
        })
      }
    });

    function addUser(data) {
      if (users[data.roomname] && users[data.roomname].indexOf(data.username) >= 0) {
        // In case of existing user in the room, log the previous user off and log the current one in
        sockets[data.username].addedUser = false
        sockets[data.username].emit('logged out', {
          msg: 'user logged in from another location'
        })
        users[data.roomname].remove(data.username);
        sockets[data.username].leave(data.roomname)
        delete sockets[data.username]

        console.log(data.username + ' left ' + data.roomname);

        // echo globally that this client has left
        socket.broadcast.to(data.roomname).emit('user left', {
          username: data.username,
          numUsers: users[data.roomname].length
        });

        /*
        socket.emit('login error', {
        msg: 'user already exists in this room'
      })
      return;
      */
      }

      // Store the socket
      sockets[data.username] = socket;

      socket.join(data.roomname);
      socket.username = data.username;
      socket.roomname = data.roomname;
      console.log(socket.username + ' joined ' + socket.roomname);

      users[socket.roomname] = users[socket.roomname] || []

      // add the client's username to the global list
      users[socket.roomname].push(socket.username);
      socket.addedUser = true;
      socket.emit('logged in', {
        numUsers: users[socket.roomname].length,
        users: users[socket.roomname],
        username: socket.username,
        roomname: socket.roomname
      })

      // echo globally (all clients) that a person has connected
      socket.broadcast.to(socket.roomname).emit('user joined', {
        username: socket.username,
        numUsers:users[socket.roomname].length
      });
    }

    // when the client emits 'new message', this listens and executes
    socket.on('new message', function (data) {
      if (typeof data.toUser == 'undefined') {
        // we tell the client to execute 'new message'
        socket.broadcast.to(socket.roomname).emit('new message', {
          username: socket.username,
          message: data.msg
        });
      }
      else {
        if (users[socket.roomname].indexOf(data.toUser) > -1 && typeof sockets[data.toUser] !== 'undefined') {
          sockets[data.toUser].emit('new message', {
            username: socket.username,
            message: data.msg,
            toUser: data.toUser
          })
        }
        else {
          socket.emit('new info', {
            message: 'Action failed. User does not exist.'
          })
        }
      }
    });

    // when the client emits 'typing', we broadcast it to others
    socket.on('typing', function () {
      socket.broadcast.to(socket.roomname).emit('typing', {
        username: socket.username
      });
    });

    // when the client emits 'stop typing', we broadcast it to others
    socket.on('stop typing', function () {
      socket.broadcast.to(socket.roomname).emit('stop typing', {
        username: socket.username
      });
    });

    // when the user disconnects.. perform this
    socket.on('disconnect', function () {
      // remove the username from global users list
      if (socket.addedUser) {
        users[socket.roomname].remove(socket.username);
        socket.leave(socket.roomname)
        console.log(socket.username + ' left ' + socket.roomname);

        // echo globally that this client has left
        socket.broadcast.to(socket.roomname).emit('user left', {
          username: socket.username,
          numUsers: users[socket.roomname].length
        });

        delete socket.roomname
        delete sockets[socket.username]
        delete socket.username
      }
    });

    socket.on('send signal', function(data) {
      //console.log('from:' + data.from + ' to:' + data.to)
      //console.log(JSON.stringify(data))
      if (!!data.to && !!data.from && typeof sockets[data.to] !== 'undefined') {
        sockets[data.to].emit('receive signal ' + data.type || 'general', data)
      }
    })

    // Non-message info
    socket.on('new info', function (data) {
      if (typeof data.toUser == 'undefined' || data.toUser.length === 0) {
        // we tell the client to execute 'new message'
        socket.broadcast.to(socket.roomname).emit('new info', {
          username: socket.username,
          message: data.msg
        });
      }
      else {
        if (typeof sockets[data.toUser] !== 'undefined') {
          sockets[data.toUser].emit('new info', {
            username: socket.username,
            message: data.msg,
            toUser: data.toUser
          })
        }
      }
    });


    // Non-message poke
    socket.on('new poke', function (data) {
      if (typeof data.toUser == 'undefined') {
        // we tell the client to execute 'new message'
        socket.broadcast.to(socket.roomname).emit('new poke', {
          username: socket.username
        });
      }
      else {
        if (users[socket.roomname].indexOf(data.toUser) > -1 && typeof sockets[data.toUser] !== 'undefined') {
          sockets[data.toUser].emit('new poke', {
            username: socket.username,
            toUser: data.toUser
          })
        }
        else {
          socket.emit('new info', {
            message: 'Action failed. User does not exist.'
          })
        }
      }
    });

    socket.on('start audio request', function(data) {
      if (users[socket.roomname].indexOf(data.to) > -1) {
        socket.emit('start audio response', {
          permitted: true,
          to: data.to
        })
      }
      else {
        socket.emit('start audio response', {
          message: 'User does not exist.',
          to: data.to
        })
      }
    })

    socket.on('start video request', function(data) {
      if (users[socket.roomname].indexOf(data.to) > -1) {
        socket.emit('start video response', {
          permitted: true,
          to: data.to
        })
      }
      else {
        socket.emit('start video response', {
          message: 'User does not exist.',
          to: data.to
        })
      }
    })

    socket.on('start file request', function(data) {
      if (users[socket.roomname].indexOf(data.to) > -1) {
        socket.emit('start file response', {
          permitted: true,
          to: data.to
        })
      }
      else {
        socket.emit('start file response', {
          message: 'User does not exist.',
          to: data.to
        })
      }
    })

  })


  Array.prototype.remove = function() {
    var what, a = arguments, L = a.length, ax;
    while (L && this.length) {
      what = a[--L];
      while ((ax = this.indexOf(what)) !== -1) {
        this.splice(ax, 1);
      }
    }
    return this;
  };

}
