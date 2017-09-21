const http = require('http');
const fs = require('fs');
const socketio = require('socket.io');

const port = process.env.PORT || process.env.NODE_PORT || 3000;

const index = fs.readFileSync(`${__dirname}/../client/client.html`);

const onRequest = (request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.write(index);
  response.end();
};

const app = http.createServer(onRequest).listen(port);
const io = socketio(app);

console.log(`Listening on 127.0.0.1: ${port}`);

// Recursive references - user.name && channel[user.channel][...]
const users = {};
const channels = { general: [], offtopic: [] };

// Helper methods

const removeFromChannel = (channel, name) => {
  channels[channel].splice(channels[channel].indexOf(name), 1);
};
const sendMessage = (socket, ch, body, usr = 'server') => {
  const message = { user: usr, msg: body, channel: ch };
  socket.emit('msg', message);
};
const sendToChannel = (ch, body, usr = 'server') =>
  sendMessage(io.sockets.in(ch), ch, body, usr);
const sendBroadcast = (socket, ch, body, usr = 'server') =>
  sendMessage(socket.broadcast.to(ch), ch, body, usr);

// Implementation methods

const onJoined = (sock) => {
  const socket = sock;

  socket.on('join', (data) => {
    const user = { name: data.name, channel: 'general' };
    users[socket.id] = user;
    channels[user.channel].push(user.name);

    socket.join(user.channel);
    socket.emit('channelList', Object.keys(channels));
  });
};

const onMsg = (sock) => {
  const socket = sock;

  socket.on('msgToServer', (data) => {
    const user = users[socket.id];

    // Custom /time command
    if (data.msg.startsWith('/time')) {
      sendMessage(socket, user.channel, `Time: ${new Date()}`);
    } else if (data.msg.startsWith('/roll')) { // Custom /roll <NdX> command
      // Split on spaces
      const split = data.msg.split(' ');
      // If we have an argument
      if (split.length > 1) {
        // Split the first arg on 'd' (syntax NdX)
        const vals = split[1].split('d');
        if (vals.length > 1) {
          // Get the number of dice to roll
          const num = Math.max(parseInt(vals[0], 10), 1);
          // Get the number of sides to roll
          const die = Math.max(parseInt(vals[1], 10), 1);
          // Counter var
          let r = 0;
          // Roll the dice
          for (let i = 0; i < num; i++) { r += Math.floor(Math.random() * die) + 1; }
          // Build the message
          const msg = `${user.name} rolled ${r} from ${split[1]}`;
          // Send the message
          sendToChannel(user.channel, msg, 'server');
        }
      }
    } else if (data.msg.startsWith('/help')) { // Custom /help command
      const msg = 'Commands:\n' +
        '/time: Sends the server time.\n' +
        '/roll <NdX>: Rolls N dice of X sides.';
      sendMessage(socket, user.channel, msg);
    } else { // Otherwise it's a standard message
      sendToChannel(user.channel, data.msg, user.name);
    }
  });
};

const onDisconnect = (sock) => {
  const socket = sock;

  socket.on('disconnect', () => {
    const user = users[socket.id];

    // Send leave message
    sendToChannel(user.channel, `${user.name} has left.`);
    // Get rid of data
    users[socket.id] = null;
    removeFromChannel(user.channel, user.name);
    // Inform everyone relevant of change
    io.sockets.in(user.channel).emit('userList', channels[user.channel]);
  });
};

const onChannelChange = (sock) => {
  const socket = sock;

  socket.on('channelChange', (data) => {
    const user = users[socket.id];

    // If we're actually changing
    if (!data.startup) {
      // Leave current channel
      socket.leave(user.channel);
      removeFromChannel(user.channel, user.name);
      sendToChannel(user.channel, `${user.name} has left ${user.channel}.`);
      // Update user lists
      socket.emit('userList', channels[user.channel]);
      io.sockets.in(user.channel).emit('userList', channels[user.channel]);

      // Join new channel
      socket.join(data.channel);
      user.channel = data.channel;
      channels[user.channel].push(user.name);
    }

    // Inform users
    const numUsers = channels[user.channel].length - 1; // Ignore self for notification purposes
    sendMessage(socket, user.channel, `There are ${numUsers} users in ${user.channel}.`);
    sendMessage(socket, user.channel, `You joined the channel ${user.channel}.`);
    sendBroadcast(socket, user.channel, `${user.name} has joined the channel.`);

    // Update user lists
    socket.emit('userList', channels[user.channel]);
    io.sockets.in(user.channel).emit('userList', channels[user.channel]);
  });
};

// Setup

io.sockets.on('connection', (socket) => {
  onJoined(socket);
  onMsg(socket);
  onDisconnect(socket);
  onChannelChange(socket);
});
