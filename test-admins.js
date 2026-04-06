const { Api } = require('telegram');
const { getClient } = require('./electron/telegramService');
const mongoose = require('mongoose');
const connectDB = require('./electron/db');
const TelegramAccount = require('./electron/models/TelegramAccount');

async function test() {
  await connectDB();
  const acc = await TelegramAccount.findOne({ connected: true });
  if (!acc) return console.log('No acc');
  const client = await getClient(acc._id.toString());
  if (!client) return console.log('Client down');

  const dialogs = await client.getDialogs({ limit: 10 });
  const group = dialogs.find(d => d.isGroup);
  if (!group) return console.log('No group found');
  console.log('Group:', group.title, group.id);

  try {
    const participants = await client.invoke(
      new Api.channels.GetParticipants({
        channel: group.id,
        filter: new Api.ChannelParticipantsAdmins(),
        offset: 0,
        limit: 100,
        hash: 0,
      })
    );
    const users = participants.users;
    let botAdmins = [];
    for (let u of users) {
      if (u.bot) {
        botAdmins.push(`@${u.username}`);
      }
    }
    console.log('Admin Bots found:', botAdmins.join(', '));
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
test();
