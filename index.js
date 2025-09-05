require('dotenv').config();

const {
  Client,
  IntentsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  } = require("discord.js");
  const { joinVoiceChannel } = require('@discordjs/voice');
  const fs = require('fs');
  const path = require('path');
  const { decrypt } = require('./utils/crypto');
  const client = new Client({
    intents: [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.GuildVoiceStates,
      IntentsBitField.Flags.MessageContent,
    ],
  });

  const statusList = ["Labourer | /setup"];
  const db = require("pro.db");
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
  });

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectDelay = 5000; // 5 detik

  function handleDisconnect() {
    console.log('Bot disconnected from Discord!');
    
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      console.log(`Attempting to reconnect... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
      
      setTimeout(() => {
        client.login(process.env.DISCORD_TOKEN).catch((error) => {
          console.error('Failed to reconnect:', error);
          handleDisconnect();
        });
      }, reconnectDelay);
    } else {
      console.error('Max reconnection attempts reached. Please check your connection and restart the bot.');
    }
  }

  client.on('error', (error) => {
    console.error('Discord Client Error:', error);
  });

  client.on('disconnect', () => {
    handleDisconnect();
  });

  client.on('reconnecting', () => {
    console.log('Bot is reconnecting...');
  });

  client.on('resume', (replayed) => {
    console.log(`Bot resumed, replayed ${replayed} events.`);
    reconnectAttempts = 0; // Reset reconnect attempts on successful connection
  });

  client.on("ready", async () => {
    // Read and decrypt ASCII art
    const encrypted = JSON.parse(fs.readFileSync(path.join(__dirname, 'ascii.encrypted'), 'utf8'));
    const asciiArt = decrypt(encrypted);
    console.log(asciiArt);
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setActivity(statusList[0]);
    setInterval(() => {
      const randomIndex = Math.floor(Math.random() * statusList.length);
      client.user.setActivity(statusList[randomIndex]);
    }, 10000);
  
    const commands = [
      new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Set up temporary voice channel system."),
    ];
  
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    try {
      await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands.map((command) => command.toJSON()),
      });
      console.log("Successfully registered application commands.");
    } catch (error) {
      console.error(error);
    }
  });
  
  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      // Cek apakah user bergabung ke voice channel
      if (!oldState.channelId && newState.channelId) {
        console.log(`${newState.member?.user.tag || "Unknown user"} joined ${newState.channel?.name || "Unknown channel"}`);
        
        // Dapatkan channel ID dari database
        const joinToCreateId = await db.get(`${newState.guild.id}.voiceChannel`);
        
        // Jika user bergabung ke channel "Join to Create" (cek berdasarkan ID)
        if (newState.channel?.id === joinToCreateId) {
          const guild = newState.guild;
  
          // Buat channel voice baru
          const tempChannel = await guild.channels.create({
            name: `${newState.member?.user.username || "User"}'s Channel`,
            type: ChannelType.GuildVoice,
            parent: newState.channel.parentId,
            permissionOverwrites: [
              {
                id: newState.member.id,
                allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ManageChannels],
              },
            ],
          });
  
          console.log(`Created new voice channel: ${tempChannel.name}`);
  
          // Pindahkan user ke channel baru
          if (newState.member?.voice) {
            await newState.member.voice.setChannel(tempChannel)
            .then(() => console.log(`Successfully moved ${newState.member.user.tag} to ${tempChannel.name}`))
            .catch(err => console.error(`Failed to move ${newState.member.user.tag}:`, err));
          } else {
            console.warn(`${newState.member?.user.tag || "User"} is not in a voice channel`);
          }
        }
      }
  
      // Cek apakah user keluar dari voice channel
      if (oldState.channelId && !newState.channelId) {
        console.log(`${oldState.member?.user.tag || "Unknown user"} left ${oldState.channel?.name || "Unknown channel"}`);
        
        // Log saja ketika channel kosong, tapi tidak menghapusnya
        if (oldState.channel?.members.size === 0) {
          console.log(`Channel ${oldState.channel.name} is now empty but will be preserved`);
        }
      }
    } catch (error) {
      console.error('Error in voiceStateUpdate:', error);
    }
  });
  
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    try {
      // Defer the reply immediately for commands
      if (interaction.isCommand()) {
        await interaction.deferReply({ flags: 64 });

        if (interaction.commandName === "setup") {
          // Check if user has administrator permission
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return await interaction.editReply({
              content: "❌ Anda tidak memiliki izin untuk menggunakan command ini. Hanya administrator yang dapat menggunakan command setup.",
              flags: 64
            });
          }

          try {
            // Create category
            const category = await interaction.guild.channels.create({
              name: "Temporary Voice System",
              type: ChannelType.GuildCategory,
              permissionOverwrites: [
                {
                  id: interaction.guild.id,
                  allow: [PermissionsBitField.Flags.ViewChannel],
                },
              ],
            });
      
            // Create text channel
            const textChannel = await interaction.guild.channels.create({
              name: "voice-interface",
              type: ChannelType.GuildText,
              parent: category.id,
              permissionOverwrites: [
                {
                  id: interaction.guild.id,
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                  ],
                },
              ],
            });
      
            // Create voice channel
            const voiceChannel = await interaction.guild.channels.create({
              name: "Join to Create",
              type: ChannelType.GuildVoice,
              parent: category.id,
              permissionOverwrites: [
                {
                  id: interaction.guild.id,
                  allow: [PermissionsBitField.Flags.Connect],
                },
              ],
            });
      
            // Save channel IDs to database
            await db.set(`${interaction.guild.id}.categoryChannel`, category.id);
            await db.set(`${interaction.guild.id}.textChannel`, textChannel.id);
            await db.set(`${interaction.guild.id}.voiceChannel`, voiceChannel.id);
      
            // Create embed and buttons
            const embed = new EmbedBuilder()
              .setAuthor({ name: "Labourer Voice Setting" })
              .setDescription(
                "Silahkan gunakan tombol dibawah ini untuk mengelola Voice Channel anda. Berikut penjelasan fungsi tombol:\n\n" +
                  "<:region_i:1327271056750149643> - Untuk mengubah **Region Voice Channel** anda\n" +
                  "<:rename_i:1327271061435318282> - Untuk mengubah **Nama Voice Channel** anda\n" +
                  "<:bitrate_i:1327271625976189030> - Untuk mengubah **Bitrate Voice Channel** anda\n" +
                  "<:kick_i:1327271621089820716> - Untuk mengeluarkan seseorang dari **Voice Channel** anda\n" +
                  "<:limit_i:1327271623476117676> - Untuk mengubah jumlah **Limit User Voice Channel** anda\n" +
                  "<:transfer_i:1327271064090181733> - untuk memindahkan kepemilikan **Voice Channel** anda kepada orang lain\n" +
                  "<:info_i:1327271042229600346> - Untuk melihat info **Voice Channel** anda\n" +
                  "<:claim_i:1327271036269494314> - Untuk klaim kepemilikan **Voice Channel**"
              )
              .setColor("#4d4d4d")
              .setFooter({
                text: interaction.guild.name,
                iconURL: interaction.guild.iconURL() || undefined,
              });
      
            // Create button rows
            const buttonsRow1 = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("change_region")
                .setEmoji("<:region_i:1327271056750149643>")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("rename_channel")
                .setEmoji("<:rename_i:1327271061435318282>")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("set_bitrate")
                .setEmoji("<:bitrate_i:1327271625976189030>")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("kick_user")
                .setEmoji("<:kick_i:1327271621089820716>")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("set_user_limit")
                .setEmoji("<:limit_i:1327271623476117676>")
                .setStyle(ButtonStyle.Secondary)
            );
      
            const buttonsRow2 = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("spacer_button")
                .setLabel("-")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
              new ButtonBuilder()
                .setCustomId("transfer_owner")
                .setEmoji("<:transfer_i:1327271064090181733>")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("channel_info")
                .setEmoji("<:info_i:1327271042229600346>")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("claim_channel")
                .setEmoji("<:claim_i:1327271036269494314>")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("spacer_button_2")
                .setLabel("-")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
            );
      
            // Send message to text channel
            await textChannel.send({
              embeds: [embed],
              components: [buttonsRow1, buttonsRow2],
            });
      
            // Edit the deferred reply with channel mentions
            await interaction.editReply({
              content: `Setup complete! ✅\n\n📝 Interface Channel: ${textChannel}\n🔊 Join Channel: ${voiceChannel}\n\nJoin the voice channel to create your own voice room!`,
              flags: 64
            });
          } catch (error) {
            console.error('Error in setup:', error);
            await interaction.editReply({
              content: "Terjadi kesalahan saat mengonfigurasi voice channel.",
              flags: 64
            });
          }
        }
      }

      // Handle button interactions
      if (interaction.isButton()) {
        try {
          const member = interaction.member;
          const voiceChannel = member.voice.channel;

          // Check if user is in a voice channel first
          if (!voiceChannel) {
            return await interaction.reply({
              content: "Anda harus berada di voice channel untuk menggunakan fitur ini!",
              ephemeral: true
            }).catch(console.error);
          }

          // Get the Join to Create channel ID
          const joinToCreateId = await db.get(`${interaction.guild.id}.voiceChannel`);

          // Handle claim_channel button
          if (interaction.customId === "claim_channel") {
            try {
              await interaction.deferReply({ ephemeral: true });

              // Don't allow claiming the Join to Create channel
              if (voiceChannel.id === joinToCreateId) {
                return await interaction.editReply({
                  content: "Anda tidak dapat mengklaim channel Join to Create!"
                });
              }

              // Get current owner permissions
              const currentOwner = voiceChannel.permissionOverwrites.cache.find(
                perm => perm.allow.has(PermissionsBitField.Flags.ManageChannels) && 
                perm.id !== interaction.guild.id
              );

              if (currentOwner) {
                // Check if owner is still in the channel
                const ownerMember = await interaction.guild.members.fetch(currentOwner.id)
                  .catch(() => null);

                if (ownerMember && ownerMember.voice.channel?.id === voiceChannel.id) {
                  return await interaction.editReply({
                    content: `Channel ini masih memiliki owner yang aktif! Silakan hubungi <@${ownerMember.id}> untuk keluar dari voice terlebih dahulu agar Anda bisa mengklaim channel ini.`
                  });
                }

                // Remove old owner's permissions if they're not in the channel
                await voiceChannel.permissionOverwrites.delete(currentOwner.id);
              }

              // Set new owner permissions
              await voiceChannel.permissionOverwrites.edit(member.id, {
                ManageChannels: true,
                Connect: true
              });

              return await interaction.editReply({
                content: `Berhasil mengklaim channel ini! Anda sekarang adalah owner dari ${voiceChannel.name}`
              });

            } catch (error) {
              console.error('Error in claim channel:', error);
              return await interaction.editReply({
                content: "Terjadi kesalahan saat mencoba mengklaim channel."
              }).catch(console.error);
            }
          }

          // For all other buttons, check if user is owner
          const owner = voiceChannel.permissionOverwrites.cache.find(
            perm => perm.allow.has(PermissionsBitField.Flags.ManageChannels) && 
            perm.id !== interaction.guild.id
          );
          
          const isOwner = owner && owner.id === member.id;

          // Restrict access to non-owners (except for channel_info)
          if (interaction.customId !== "channel_info" && !isOwner) {
            return await interaction.reply({
              content: "Hanya owner channel yang dapat menggunakan fitur ini!",
              ephemeral: true
            }).catch(console.error);
          }

          // Handle other buttons with modal
          switch (interaction.customId) {
            case "rename_channel":
            case "set_bitrate":
            case "transfer_owner":
            case "kick_user":
            case "set_user_limit":
            case "change_region":
              try {
                const modalData = {
                  rename_channel: {
                    id: "rename_channel_modal",
                    title: "Rename Voice Channel",
                    input: {
                      id: "new_channel_name",
                      label: "Nama Baru Channel",
                      placeholder: "Masukkan nama baru untuk channel"
                    }
                  },
                  set_bitrate: {
                    id: "set_bitrate_modal",
                    title: "Set Voice Channel Bitrate",
                    input: {
                      id: "bitrate_value",
                      label: "Bitrate (8-96 kbps)",
                      placeholder: "Contoh: 64"
                    }
                  },
                  transfer_owner: {
                    id: "transfer_owner_modal",
                    title: "Transfer Kepemilikan Channel",
                    input: {
                      id: "new_owner_username",
                      label: "Username Baru",
                      placeholder: "Masukkan Username penerima Voice Room ini(TANPA #2910)"
                    }
                  },
                  kick_user: {
                    id: "kick_user_modal",
                    title: "Kick User dari Channel",
                    input: {
                      id: "username_to_kick",
                      label: "Username",
                      placeholder: "Masukkan Username yang akan di-kick(TANPA #2910)"
                    }
                  },
                  set_user_limit: {
                    id: "set_user_limit_modal",
                    title: "Set User Limit Channel",
                    input: {
                      id: "user_limit_value",
                      label: "User Limit (0-99)",
                      placeholder: "0 = unlimited"
                    }
                  },
                  change_region: {
                    id: "change_region_modal",
                    title: "Change Voice Channel Region",
                    input: {
                      id: "region_value",
                      label: "Region",
                      placeholder: "brazil, japan, rotterdam, singapore, sydney, us-central"
                    }
                  }
                };

                const modalInfo = modalData[interaction.customId];
                const modal = new ModalBuilder()
                  .setCustomId(modalInfo.id)
                  .setTitle(modalInfo.title);

                modal.addComponents(
                  new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                      .setCustomId(modalInfo.input.id)
                      .setLabel(modalInfo.input.label)
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true)
                      .setPlaceholder(modalInfo.input.placeholder)
                      .setMinLength(1)
                      .setMaxLength(32)
                  )
                );

                await interaction.showModal(modal);
              } catch (error) {
                console.error(`Error showing ${interaction.customId} modal:`, error);
                await interaction.reply({
                  content: "Terjadi kesalahan saat membuka modal. Silakan coba lagi.",
                  ephemeral: true
                }).catch(console.error);
              }
              break;

            case "channel_info":
              try {
                await interaction.deferReply({ ephemeral: true });
                
                const owner = voiceChannel.permissionOverwrites.cache.find(
                  perm => perm.allow.has(PermissionsBitField.Flags.ManageChannels) && 
                  perm.id !== interaction.guild.id
                );
                
                const ownerMember = owner 
                  ? await interaction.guild.members.fetch(owner.id).catch(() => null)
                  : null;

                const ping = Math.round(client.ws.ping);
                const pingStatus = ping < 100 ? "🟢" : ping < 200 ? "🟡" : "🔴";

                const infoEmbed = new EmbedBuilder()
                  .setTitle("Channel Information")
                  .setColor("#00FF00")
                  .addFields([
                    { name: "Channel Name", value: voiceChannel.name, inline: true },
                    { name: "Channel Owner", value: ownerMember ? ownerMember.user.tag : "No owner", inline: true },
                    { name: "Region", value: voiceChannel.rtcRegion || "Auto", inline: true },
                    { name: "Bitrate", value: `${voiceChannel.bitrate / 1000}kbps`, inline: true },
                    { name: "User Limit", value: voiceChannel.userLimit === 0 ? "Unlimited" : voiceChannel.userLimit.toString(), inline: true },
                    { name: "Connected Users", value: voiceChannel.members.size.toString(), inline: true },
                    { name: "Bot Latency", value: `${pingStatus} ${ping}ms`, inline: true }
                  ])
                  .setTimestamp()
                  .setFooter({
                    text: `Channel ID: ${voiceChannel.id}`,
                    iconURL: interaction.guild.iconURL() || undefined
                  });

                await interaction.editReply({
                  embeds: [infoEmbed]
                });
              } catch (error) {
                console.error('Error in channel info:', error);
                await interaction.editReply({
                  content: "Terjadi kesalahan saat mengambil informasi channel."
                }).catch(console.error);
              }
              break;

            default:
              await interaction.reply({
                content: "Fitur ini sedang dalam perbaikan.",
                ephemeral: true
              }).catch(console.error);
              break;
          }

        } catch (error) {
          console.error('Error handling button:', error);
          try {
            const errorMessage = "Terjadi kesalahan saat memproses permintaan Anda.";
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({ content: errorMessage, ephemeral: true }).catch(console.error);
            } else if (interaction.deferred) {
              await interaction.editReply({ content: errorMessage }).catch(console.error);
            }
          } catch (replyError) {
            console.error('Error sending error message:', replyError);
          }
        }
      }

      // Handle modal submissions
      if (interaction.isModalSubmit()) {
        try {
          await interaction.deferReply({ flags: 64 });
          const member = interaction.member;
          const voiceChannel = member.voice.channel;

          if (!voiceChannel) {
            return interaction.editReply({
              content: "Anda harus berada di voice channel untuk menggunakan fitur ini!",
              flags: 64
            });
          }

          switch (interaction.customId) {
            case "rename_channel_modal":
              const newName = interaction.fields.getTextInputValue("new_channel_name");
              await voiceChannel.setName(newName);
              await interaction.editReply({
                content: `Nama channel berhasil diubah menjadi: ${newName}`,
                flags: 64
              });
              break;

            case "set_bitrate_modal":
              const bitrate = parseInt(interaction.fields.getTextInputValue("bitrate_value"));
              if (isNaN(bitrate) || bitrate < 8 || bitrate > 96) {
                await interaction.editReply({
                  content: "Bitrate harus antara 8-96 kbps!",
                  flags: 64
                });
                return;
              }
              await voiceChannel.setBitrate(bitrate * 1000);
              await interaction.editReply({
                content: `Bitrate channel diatur ke ${bitrate} kbps`,
                flags: 64
              });
              break;

            case "transfer_owner_modal":
              const newOwnerUsername = interaction.fields.getTextInputValue("new_owner_username");
              try {
                const newOwner = interaction.guild.members.cache.find(
                  (m) => m.user.username === newOwnerUsername
                );
                if (!newOwner) throw new Error("User tidak ditemukan");
            
                await voiceChannel.permissionOverwrites.edit(interaction.member.id, { 
                  ViewChannel: false, 
                  ManageChannels: false 
                });
                await voiceChannel.permissionOverwrites.edit(newOwner.id, { 
                  ViewChannel: true, 
                  ManageChannels: true 
                });
            
                await interaction.editReply({
                  content: `Kepemilikan channel ditransfer ke ${newOwner.user.tag}`,
                  ephemeral: true
                });
              } catch (error) {
                console.error(error);
                await interaction.editReply({
                  content: "User tidak ditemukan atau terjadi kesalahan!",
                  ephemeral: true
                });
              }
              break;

            case "kick_user_modal":
              const usernameToKick = interaction.fields.getTextInputValue("username_to_kick");
              try {
                const targetMember = interaction.guild.members.cache.find(
                  (m) => m.user.username === usernameToKick
                );
                if (!targetMember) throw new Error("User tidak ditemukan");
              
                if (targetMember.voice.channel && targetMember.voice.channel.id === voiceChannel.id) {
                  await targetMember.voice.disconnect();
                  await interaction.editReply({
                    content: `${targetMember.user.tag} telah di-kick dari channel`,
                    ephemeral: true
                  });
                } else {
                  await interaction.editReply({
                    content: "User tersebut tidak berada di channel ini!",
                    ephemeral: true
                  });
                }
              } catch (error) {
                await interaction.editReply({
                  content: "User tidak ditemukan atau terjadi kesalahan!",
                  ephemeral: true
                });
              }
              break;

            case "set_user_limit_modal":
              const limit = parseInt(interaction.fields.getTextInputValue("user_limit_value"));
              if (isNaN(limit) || limit < 0 || limit > 99) {
                await interaction.editReply({
                  content: "Limit harus antara 0-99!",
                  flags: 64
                });
                return;
              }
              await voiceChannel.setUserLimit(limit);
              await interaction.editReply({
                content: `User limit diatur ke ${limit} ${limit === 0 ? '(unlimited)' : 'user'}`,
                flags: 64
              });
              break;

            case "change_region_modal":
              const region = interaction.fields.getTextInputValue("region_value").toLowerCase();
              const validRegions = ['brazil', 'japan', 'rotterdam', 'singapore', 'sydney', 'us-central'];
              
              if (!validRegions.includes(region)) {
                await interaction.editReply({
                  content: `Region tidak valid! Region yang tersedia:\n${validRegions.join(', ')}`,
                  flags: 64
                });
                return;
              }

              try {
                await voiceChannel.setRTCRegion(region);
                await interaction.editReply({
                  content: `Region channel diubah ke: ${region}`,
                  flags: 64
                });
              } catch (error) {
                console.error('Error setting region:', error);
                await interaction.editReply({
                  content: "Gagal mengubah region channel!",
                  flags: 64
                });
              }
              break;
          }
        } catch (error) {
          console.error('Error handling modal submit:', error);
          await interaction.editReply({
            content: "Terjadi kesalahan saat memproses input Anda.",
            flags: 64
          });
        }
      }

    } catch (error) {
      console.error('Error in interaction:', error);
      try {
        const errorMessage = "Terjadi kesalahan saat memproses permintaan Anda. Bot tetap berjalan.";
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: errorMessage, ephemeral: true }).catch(console.error);
        } else {
          await interaction.editReply({ content: errorMessage }).catch(console.error);
        }
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
    }
  });
  
  client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Failed to login:', error);
    handleDisconnect();
  });
  
  setInterval(() => {
    try {
      if (client.ws.status === 0) {
        console.log('Bot heartbeat OK - WebSocket connected');
      } else {
        console.warn('Bot heartbeat warning - WebSocket status:', client.ws.status);
        if (client.ws.status === 6) { // Disconnected
          handleDisconnect();
        }
      }
    } catch (error) {
      console.error('Error checking heartbeat:', error);
    }
  }, 30000); // Check every 30 seconds
  