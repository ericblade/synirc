// TODO: at app startup, have it check to see if we have the correct sync activity, and restart/create it if it's not running?
// TODO: don't even start the activity until we are connected. 
// TODO: Could actually roll this up as a quickie - have the app specify server, username, realname, startup channels, create an account,
//       then have a "Start/Stop" button.  
// TODO: Keep track of a map of Clients for use with multiple servers? Store the server name in the account data.
//       Clients["irc.freenode.net"], Clients["irc.efnet.org"], etc
// TODO: When setting up a connection, cache the account id in the client object
// TODO: Watch on loginstate db, when toggled offline, shutdown that client, if no more clients left, send a command to the app to close
//       .. when toggled online, set status to connecting (however that's done), launch app, when we receive the 001 for that client, set the account's
//       status to online
// TODO: store the server name (as used as a key in the clients array, NOT as reported by the messages --
//       irc.freenode.net usually equals something-else.freenode.net) in the "from" part of the database, or something like that, so we know
//       what server the outgoing messages are going out to
// TODO: add /join, /part, /msg, etc
// TODO: can messages be stored marked as read, to avoid getting the constant alerts?
// TODO: if so, add an option to the account setup that will allow people to only get notification alerts on private messages, or on mentions
// TODO: keep track of what channels we're on, and do not send messages to those channels until after we've joined them

var fs = require('fs');
var servicePath = fs.realpathSync('.');
var modulePath = servicePath + '/node_modules';

var irc = require(modulePath+'/irc');

disconnect = Class.create({
	run: function(future) {
		var assistant = this.controller.service.assistant;
		if(assistant.client)
		    assistant.client.disconnect("Pressed the Disconnect button");
		assistant.client = undefined;
		future.result = { returnValue: true };
	}
});

subscribeToMe = Class.create({
	cancelSubscription: function()
	{
		var assistant = this.controller.service.assistant;		
		console.log("Subscription cancellation");
		PalmCall.call("palm://com.palm.applicationManager/", "launch", { id: "com.ericblade.synirc", params: { "resub": true } });
	},
	createGroupChat: function(name)
	{
		console.log("createGroupChat", name);
		var future = new Future;
		var dbq = {
			from: "com.ericblade.synirc.imgroupchat:1",
			where: [
				{ prop: "groupName", op: "=", val: name }
			]
		};
		future.nest(DB.find(dbq, false, false).then(function(fut) {
			if(fut.result.results.length == 0)
			{
				console.log("creating new imgroupchat");
				var dbGroup = {
					_kind: "com.ericblade.synirc.imgroupchat:1",
					groupName: name,
					displayName: name,
					serviceName: "type_synirc",
					members: [ ],
				};
				fut.nest(DB.put([dbGroup]).then(function(fut2) {
					console.log("createGroupChat put result=", JSON.stringify(fut2.result));
					fut2.result = { returnValue: true };
					fut.result = { returnValue: true };
				}));
			} else {
				console.log("existing imgroupchat found");
			}
		}));
		return future;
	},
	addMessage: function(from, to, message)
	{
		var f = new Future();
		var timestamp = new Date().getTime();
		
		var dbMsg = {
			_kind: "com.ericblade.synirc.immessage:1",
			//accountId: args.accountId,
			localTimestamp: parseInt(timestamp),
			timestamp: parseInt(timestamp),
			folder: "inbox",
			status: "successful",
			messageText: message,
			from: { addr: from }, 
			to: [ { addr: to } ], 
			serviceName: "type_synirc",
			flags: { },
			username: this.nickname // this is being routed into the client object.. right?
		};
		if(message.indexOf(this.nickname) !== -1)
		{
			dbMsg.flags.read = false;
			dbMsg.flags.noNotification = false;
		}
		if(to.indexOf("#") == 0) // channel, groupchat
		{
			if(dbMsg.flags.read !== false) // we've already processed that the message has a mention of us in it
			{
				//dbMsg.flags.read = true;
				dbMsg.flags.read = false;
				dbMsg.flags.noNotification = true;
			}
			dbMsg.groupChatName = to;
			dbMsg.from.name = from;
			f.nest(this.createGroupChat(to).then(function(fut) {
				console.log("createGroupChat result=", JSON.stringify(fut.result));
				f.result = fut.result;
			}));
		}
		f.nest(DB.put([ dbMsg ]).then(function(fut) {
			console.log(JSON.stringify(dbMsg));
			console.log("db result=", JSON.stringify(fut.result));
			f.result = { put: dbMsg, dbres: fut.result, from: from, to: to, message: message };
			fut.result = f.result;
		}));		
	},
	run: function(future, subscription)
	{
		var assistant = this.controller.service.assistant;
		var args = this.controller.args;
		var bReg = false;
		
		if(!args.server) args.server = "irc.freenode.net";
		if(!args.nick) args.nick = "SynIRC_User" + Math.floor((Math.random() * 1000) + 1);
		if(!args.userName) args.userName = "synirc";
		if(!args.realName) args.realName = "webOS Synergy User";
		if(!args.channels) args.channels = [ '#touchpad' ];
		
		//var client = new irc.Client('irc.freenode.net', 'EricBladeSynergy', { userName: 'synirc', realName: "webOS Synergy",
		//							channels: [ '#testsynergy', '#webos', '#webos-internals', '#touchpad', '#openwebos', '#enyojs' ]} );
		if(assistant.client === undefined)
		{
			var client = new irc.Client(args.server, args.nick, { userName: args.userName, realName: args.realName, channels: args.channels });
			assistant.client = client;
			assistant.client.createGroupChat = this.createGroupChat;
			assistant.client.nickname = args.nick;
			assistant.client.addMessage = this.addMessage;
			
			setInterval(function() {
				var f = subscription.get();
				f.result = { action: "serviceping", returnValue: true };
			}, 25000);
			client.addListener('message', function(from, to, message) {
				var f = subscription.get();
				f.result = { from: from, to: to, message: message };
				console.log(from + ' => ' + to + ': ' + message);
				this.addMessage(from, to, message);
			});
			client.addListener('ctcp', function(from, to, text, type) {
				var f = subscription.get();
				f.result = { from: from, action: "ctcp", type: type, to: to, message: text, };
				console.log(from + " ctcp " + type + " " + to + ":" + text);
				this.addMessage(from, to, text);
			});
			client.addListener('registered', function(message) {
				var f = subscription.get();
				f.result = { registered: true, message: message };
				console.log("Service connected - should adjust our online status in the database here");			
			});
			client.addListener('join', function(channel, nick, message) {
				var f = subscription.get();
				console.log(nick, "joined", channel);
				f.result = { from: nick, action: "join", channel: channel };
				this.addMessage(nick, channel, nick + " joined " + channel);
			});
			client.addListener('part', function(channel, nick, reason, message) {
				var f = subscription.get();
				f.result = { from: nick, action: "part", channel: channel, reason: reason };
				console.log(nick, "part", channel);
				this.addMessage(nick, channel, nick + " left " + channel);
			});
			client.addListener('quit', function(nick, reason, channels, message) {
				var f = subscription.get();
				f.result = { from: nick, action: "quit", channels: channels };
				console.log(nick, "quit");
				channels.forEach(function(chan) {
					this.addMessage(nick, chan, nick + " quit IRC");
				}, this);
			});
			client.addListener('kick', function(channel, nick, by, reason, message) {
				var f = subscription.get();
				f.result = { from: nick, action: "kicked", channel: channel, by: by, reason: reason };
				console.log(by, "kicked", nick, "from", channel);
				this.addMessage(nick, channel, by + " kicked " + nick + " from " + channel);
			});
			client.addListener('kill', function(nick, reason, channels, message) {
				var f = subscription.get();
				f.result = { from: nick, action: "killed", channels: channels };
				console.log(nick, "got killed");
				channels.forEach(function(chan) {
					this.addMessage(nick, chan, nick + " was killed");
				}, this);
			});
			client.addListener('notice', function(nick, to, text, message) {
				var f = subscription.get();
				if(!nick) nick = "Server notice";
				if(to == "*") to = this.nickname;
				f.result = { from: nick, action: "notice", to: to, text: text };
				console.log(nick, "noticed", to, ":", text);
				this.addMessage(nick, to, nick + "> " + text);
			});
			client.addListener('error', function(message) {
				var f = subscription.get();
				f.result = { action: "error", message: message };
				console.log("error:", JSON.stringify(message));
			});
			client.addListener('nick', function(oldnick, newnick, channels, message) {
				var f = subscription.get();
				f.result = { from: oldnick, action: "nickname", to: newnick, channels: channels };
				console.log(oldnick, "changed nickname to", newnick);
				if(oldnick == this.nickname) {
					this.nickname = newnick;
				}
				channels.forEach(function(chan) {
					this.addMessage(oldnick, chan, oldnick + " is now known as " + newnick);
				}, this);
			});
		} else {
			bReg = true;
		}
		if(bReg)
		    future.result = { registered: true, returnValue: true };
		else
		    future.result = { returnValue: true };
	}
});

// TODO: we need to disable/cancel our Activity at onEnable with enabled: false
// TODO: probably also need to setup an activity that's name is based on the account name,
//       so that we have one activity per account, and then it should be cake to
//       know which account it wants us to work on.  Also, someone could have multiple
//       accounts for a service, with only one of them enabled for messaging (if you have more than one capability)
// TODO: I think I'd like to add a seperate file that actually handles the
//       login/authenticate/retrieve messages/send messages stuff, and mostly just
//       leave this file alone.

// NOTE: There are a few service calls to the Palm ActivityManager service
// in this source code, that are currently commented out.  I/We need to figure
// out how to properly get the ActivityManager to work to make the most efficient
// use of the database and built-in power saving functions of webOS.
// At the moment, I have wired a simple 5-minute sync timer that should sync
// incoming and outgoing messages at the same time.
// Ideally, we want to have the service as idle as possible, so we want to just
// wake it when a user actually inserts a message into the database.
// Personally, I'm not sure exactly how IM services that need a persistent
// connection are going to handle this, but hopefully we can come up with something
// there.
//
// Also, there is a bug in this that does not show the account type inside the
// messaging app's drop down status list.  I'm not certain, but I think that
// may be due to the example account setup not having a CONTACTS connector.

// Just a log to say we're present.  After installing the app/service, you can
// run "run-js-service -k /media/cryptofs/apps/usr/palm/services/your.service.directory"
// to see the actual output from the service.  That has been instrumental in helping me
// to figure out what's going on in here.  As well as "ls-monitor" to watch the
// service bus.
console.log("Loading serviceEndPoints *****************************************************");

// Called to test your credentials given - this is specified in the account-template.json, under "validator"
// args = { "username": username entered, "password": password entered,
//          "templateId": our template, "config": { ? } }
// return a "credentials" object and a "config" object.  The "config" object will get passed to
// the onCreate function when your account is created.
//
// Use this to go to your online service, and verify that the login information
// given by the user works.  Return any credentials you will need to login to the
// system again (ie username, password, service key, whatever), so that they will
// be passed to onCreate, where you can save them.
// Also called when credentials stop working, such as an expired access code, or
// password change, and the user enters new information.

// Here are a list of possible errors that you can return, using throw new Error("code") or future.setException(Error("code")) or some such
// maybe future.setException(Foundations.Err.create(error.code));
// Taken from the webOS 3.0 accounts app:
/*
                "UNKNOWN_ERROR":                                accountsRb.$L("Unknown error"),
                "401_UNAUTHORIZED":                             accountsRb.$L("The account credentials you entered are incorrect. Try again."),
                "408_TIMEOUT":                                  accountsRb.$L("Request timeout"),
                "500_SERVER_ERROR":                             accountsRb.$L("Server error"),
                "503_SERVICE_UNAVAILABLE":              accountsRb.$L("Server unavailable"),
                "412_PRECONDITION_FAILED":              accountsRb.$L("The request is not suitable for the current configuration"),
                "400_BAD_REQUEST":                              accountsRb.$L("Bad request"),
                "HOST_NOT_FOUND":                               accountsRb.$L("Host not found"),
                "CONNECTION_TIMEOUT":                   accountsRb.$L("Connection timeout"),
                "CONNECTION_FAILED":                    accountsRb.$L("Connection failed"),
                "NO_CONNECTIVITY":                              accountsRb.$L("Must be connected to a network to sign in"),
                "ENOTFOUND":                                    accountsRb.$L("Must be connected to a network to sign in"),
                "SSL_CERT_EXPIRED":                             accountsRb.$L("SSL certificate expired"),
                "SSL_CERT_UNTRUSTED":                   accountsRb.$L("SSL certificate untrusted"),
                "SSL_CERT_INVALID":                             accountsRb.$L("SSL certificate invalid"),
                "SSL_CERT_HOSTNAME_MISMATCH":   accountsRb.$L("SSL certificate hostname mismatch"),
                "SINGLE_ACCOUNT_ONLY":                  accountsRb.$L("Only one account of this type can exist"),
                "TIMESTAMP_REFUSED":                    accountsRb.$L("Device date incorrect"),
                "DUPLICATE_ACCOUNT":                    accountsRb.$L("Duplicate account"),
                "UNSUPPORTED_CAPABILITY":               accountsRb.$L("Your account is not configured for this service."),
                "INVALID_EMAIL_ADDRESS":                accountsRb.$L("Please enter a valid email address."),
                "INVALID_USER":                                 accountsRb.$L("Invalid user"),
                "ACCOUNT_RESTRICTED":                   accountsRb.$L("User account restricted"),
                "ACCOUNT_LOCKED":                               accountsRb.$L("Your account is locked.  Please log in using a web browser"),
                "CALENDAR_DISABLED":                    accountsRb.$L("Your account does not have calendar enabled. Please log in to your account and
*/

checkCredentials = Class.create({
	run: function(future) {
		var args = this.controller.args;
		console.log("checkCredentials", args.username, args.password);
		future.result = {
			returnValue: true,
			credentials: {
				common: {
					password: args.password,
					username: args.username
				}
			},
			config: {
				password: args.password,
				username: args.username
			}
		}
	}
});

// Called when your account is created from the Accounts settings, use this
// function to create any account specific information.  In this example,
// we're going to create a loginstate object, so the messaging app can see that
// we do, in fact, exist.
// specified in your account-template.json

onCreate = Class.create({
	run: function(future) {
		var args = this.controller.args;
		console.log("onCreate args=", JSON.stringify(args));
		future.result = { returnValue: true };
	}
});

// Called when your account is deleted from the Accounts settings, probably used
// to delete your account info and any stored data

onDelete = Class.create({
	run: function(future) {
		var args = this.controller.args;
		console.log("onDelete", JSON.stringify(args));
		DB.del({ from: "com.ericblade.synirc.loginstate:1" }).then(function(fut) {
			fut.result.returnValue = true;
			future.result = fut.result;
		});
	}
});

var onCapabilitiesChanged = function(future) {};

// Called when multiple capabilities are changed, instead of calling onEnabled several times
// Only apparently useful if your service handles multiple Synergy capabilities

onCapabilitiesChanged.prototype.run = function(future) {
    console.log("onCapabilitiesChanged");
}
 
var onCredentialsChanged = function(future) {};

// Called when user has entered new, validated credentials
// Intended so that if you've been not syncing due to a credentials failure, then you'll know
// that it should be good to go again

onCredentialsChanged.prototype.run = function(future) { 
    console.log("onCredentialsChanged"); 
    future.result = { returnValue: true }; 
};

var loginStateChanged = function(future) {};

// Included as part of the template.  You may want to set up a database watch
// on your imstate objects, so you know when someone hits the "Offline" or
// "online" toggle in the Messaging app, so that you can login/logout.
loginStateChanged.prototype.run = function(future) {
	console.log("loginStateChanged");
	future.result = { returnValue: true };
};

var sendIM = function(future) {};

// Included as part of the template.  You might want to fill this in with
// your outgoing message code, to make it easy to call when needed.
sendIM.prototype.run = function(future) {
	var args = this.controller.args;
	var assistant = this.controller.service.assistant;
	
	assistant.client.say(args.to, args.text);
	future.result = { returnValue: true };
};

var sendCommand = function(future) {};

// Included as part of the template.  You might want to fill this in with
// any outgoing command code, to make it easy to call when needed.
sendCommand.prototype.run = function(future) {
	
	var args = this.controller.args;
	var assistant = this.controller.service.assistant;
	var client = assistant.client;
	var cmd = args.command.toLowerCase();
	var tail = args.tail;
	var target = args.target;

	console.log("sendCommand cmd=", cmd, "target=", target, "tail=", tail);
	
	switch(cmd) {
		case "join":
			client.join(tail);
			break;
		case "part":
			client.part(tail || target);
			break;
		case "ctcp":
			client.ctcp(target, "privmsg", tail);
			break;
		case "me":
		case "action":
			client.action(target, tail);
			break;
		case "notice":
			client.notice(target, tail);
			break;
		case "whois":
			client.whois(tail || target);
			break;
		case "list":
			client.list(tail);
			break;
		case "help":
		case "?":
		default:
			break;
	}
	
	future.result = { returnValue: true };
};

//*****************************************************************************
// Capability enabled notification - called when capability enabled or disabled
//*****************************************************************************
var onEnabled = function(future){};

//
// Synergy service got 'onEnabled' message. When enabled, a sync should be started and future syncs scheduled.
// Otherwise, syncing should be disabled and associated data deleted.
// Account-wide configuration should remain and only be deleted when onDelete is called.
// onEnabled args should be like { accountId: "++Mhsdkfj", enabled: true }
// 

onEnabled.prototype.run = function(future) {  
    var args = this.controller.args;

    console.log("onEnabledAssistant args.enabled=", args.enabled);
	
	if(!args.enabled)
	{
		future.onError(function(f) {
			console.log("disable account error handler gets", f.exception);
			future.result = { returnValue: true };
		});
		// cancel our sync activity, and remove the entry from the messaging loginstates,
		// so we no longer show up in the app
		future.nest(PalmCall.call("palm://com.ericblade.synirc.service/", "cancelActivity", { }).then(function(f) {
			DB.del({ from: "com.ericblade.synirc.loginstate:1" });
			future.result = { returnValue: true };
		}));
	}
	else
	{
		// Create an object to insert into the database, so that the messaging app
		// knows that we exist.
		var loginStateRec = {
			"objects":[
			{
				_kind: "com.ericblade.synirc.loginstate:1",
				// TODO: we should pull this from the account template.. how?
				serviceName: "type_synirc",
				accountId: args.accountId,
				username: "SynIRC", 
				state: "online", // it doesn't -seem- to matter what i put here, there may be another parameter involved
				availability: 0
			}]
		};

		// And then start an Activity to organize our syncing		
		future.nest(DB.put(loginStateRec.objects).then(function(f) {
			console.log("loginstate put result", JSON.stringify(f.result));
		}));
		
		/*var act =
		{
			start: true,
			activity:
			{
				name: "SynIRCOutgoingSync",
				description: "SynIRC Pending Messages Watch",
				type:
				{
					foreground: true,
					power: true,
					powerDebounce: true,
					explicit: true,
					persist: true
				},
				requirements:
				{
					internet: true
				},
				trigger:
				{
					method: "palm://com.palm.db/watch",
					key: "fired",
					params:
					{
						subscribe: true,
						query:
						{
							from: "com.ericblade.synirc.immessage:1",
							where:
							[
								{ prop: "status", op: "=", val: "pending" },
								{ prop: "folder", op: "=", val: "outbox" },
							],
							limit: 1
						}
					},
				},
				callback:
				{
					method: "palm://com.ericblade.synirc.service/sync",
					params: {}
				}
			}
		};

		future.nest(PalmCall.call("palm://com.palm.activitymanager/", "create", act).then(function(f) {
			console.log("activity create result=", JSON.stringify(f.result));
			f.result = { returnValue: true };
			future.result = { returnValue: true };
		}));*/
		future.nest(PalmCall.call("palm://com.ericblade.synirc.service/", "startActivity", {}).then(function(f) {
			console.log("activity create result=", JSON.stringify(f.result));
			f.result = { returnValue: true };
			future.result = { returnValue: true };
		}));
	}					  
};


// Here's some possibly not well known things about the services that I'm learning while attempting to read the
// service code itself (which is in Javascript, but without knowing it's intentions, it's quite difficult to read
// for my skill level)
//
// The command assistants appear to be instances of Prototype js lib Classes.
// You should be able to do something like
//
// runCommandAssistant = Class.create({ run: ..., complete: ... })
//
// This would make it a lot more enyo-like in structure.
//
// Available functions that the service appears to call inside a class:
//
// setup - called before running a command (we should try to adopt a thing here, perhaps)
// commandTimeout - not a function, but apparently you can set the timeout for individual commands by setting a commandTimeout
//                  variable.  This will override the command's configured timeout or the service as a whole's timeout
// timeoutReceived - called when a command has reached it's timeout
// complete - called when a command run is completed
// cleanup - called after complete
// yield - called when a "yield" Event happens, whatever that means
// cancelSubscription - presumably called when a subscription is cancelled

// The "sync" assistant is normally called from the CONTACTS "Sync Now" button.
// This doesn't seem to be the case when a MESSAGING connector is added, but we're going
// to use this to fire off a database watch.  If you're going to be retrieving data from the
// internet (presumably!) you probably want to add a call to the Alarm function, so that you
// can get a wake up alert here.
// Keep in mind that Synergy can create multiple accounts of one type, so you probably want to dig up
// all possible accountinfos, and sync them all.

// TODO: Add support to the test app to inject accountId here

var startActivity = Class.create({
	run: function(activityFuture)
	{
		var args = this.controller.args;
		PalmCall.call("palm://com.palm.activitymanager/", "create",
		{
			start: true,
			activity: {
				name: "SynIRCOutgoingSync",
				description: "SynIRC Pending Messages Watch",
				type: {
					foreground: true,
					power: true,
					powerDebounce: true,
					explicit: true,
					persist: false,
				},
				requirements: {
					internet: true
				},
				trigger: {
					method: "palm://com.palm.db/watch",
					key: "fired",
					params: {
						subscribe: true,
						query: {
							from: "com.ericblade.synirc.immessage:1",
							where: [
								{ prop: "status", op: "=", val: "pending" },
								{ prop: "folder", op: "=", val: "outbox" }
							],
							limit: 1
						}
					}
				},
				callback: {
					method: "palm://com.ericblade.synirc.service/sync",
					params: {}
				}
			}
		}).then(function(f) {
			console.log("startActivity result=", JSON.stringify(f.result));
			activityFuture.result = f.result;
		});
	}
});

var adoptActivity = Class.create({
	run: function(adoptFuture)
	{
		var args = this.controller.args;
		PalmCall.call("palm://com.palm.activitymanager/", "adopt", {
			activityName: "SynIRCOutgoingSync",
			wait: true,
			subscribe: true
		}).then(function(f) {
			console.log("adoptActivity result", JSON.stringify(f.result));
			adoptFuture.result = f.result;
		});
	}
});

var completeActivity = Class.create({
	run: function(completeFuture)
	{
		var args = this.controller.args;
		PalmCall.call("palm://com.palm.activitymanager/", "complete", {
			activityName: "SynIRCOutgoingSync",
			restart: true,
			// the docs say you shouldn't need to specify the trigger and callback conditions again, i think..
			// someone else said reset the callback to a different function .. to avoid the "Temporarily Not Available" problem
			// other people say you do. so let's try it.
			trigger: {
			  key: "fired",
			  method: "palm://com.palm.db/watch",		  
			  params: {
				  query: {
					  from: "com.ericblade.synirc.immessage:1",
					  where:
					  [
						  { "prop":"folder", "op":"=", "val":"outbox" },
						  { "prop":"status", "op":"=", "val":"pending" }, 
					  ]
				  },
				  subscribe: true
			  },
			}
		}).then(function(f) {
			console.log("completeActivity result", JSON.stringify(f.result));
			completeFuture.result = f.result;
		});
	}
});

var cancelActivity = Class.create({
	run: function(cancelFuture)
	{
		var args = this.controller.args;
		PalmCall.call("palm://com.palm.activitymanager/", "cancel", {
			activityName: "SynIRCOutgoingSync"
		}).then(function(f) {
			cancelFuture.result = f.result;
		});
	}
})

var sync = Class.create({
	setup: function() {
		var args = this.controller.args;
		console.log("sync setup start");
	},
	run: function(syncFuture) {
		var args = this.controller.args;
		console.log("sync run start");
		var f = new Future();
		var query = {
					  from: "com.ericblade.synirc.immessage:1",
					  where:
					  [
						  { "prop":"folder", "op":"=", "val":"outbox" },
						  { "prop":"status", "op":"=", "val":"pending" },
						  // TODO: add serviceName and userName to this query
					  ]
				  };

		f.now(function(future) {
			future.nest(DB.find(query, false, false).then(function(dbFuture) {
				console.log("dbFuture result=", JSON.stringify(dbFuture.result));
				var dbResult = dbFuture.result;
				if(dbResult.results)
				{
					var mergeIDs = [ ];
					// Call our sendIM service function to actually send each message
					// Record each message ID into an array, and then update them in
					// the database as "successful", ie - sent.
					// You may want to not mark them as sent in the database until they
					// are actually sent via your sendIM function, though.
					for(var x = 0; x < dbResult.results.length; x++)
					{
						console.log("Merging status of ", dbResult.results[x]["_id"]);
						if(dbResult.results[x].messageText.indexOf("/") === 0)
						{
							var t = dbResult.results[x].messageText;
							var cmd = t.split(" ")[0];
							cmd = cmd.substr(1);
							var tail = t.substr(t.indexOf(" ") + 1);
							PalmCall.call("palm://com.ericblade.synirc.service/", "sendCommand", {
								command: cmd,
								tail: tail,
								target: dbResult.results[x].to[0].addr,
							});
						} else {
							PalmCall.call("palm://com.ericblade.synirc.service/", "sendIM", {
								to: dbResult.results[x].to[0].addr,
								text: dbResult.results[x].messageText
							});
						}
						mergeIDs.push( { "_id": dbResult.results[x]["_id"], "status": "successful" });
					}
					DB.merge(mergeIDs);
				}
				syncFuture.result = { returnValue: true };
			}));
		});
	},
	complete: function() {
		var args = this.controller.args;
		var activity = args.$activity;
		console.log("sync complete starting", activity ? activity.activityId : "no activity");
		return activity && PalmCall.call("palm://com.palm.activitymanager/", "complete", {
			activityId: activity.activityId,
			restart: true,
			// the docs say you shouldn't need to specify the trigger and callback conditions again, i think..
			// someone else said reset the callback to a different function .. to avoid the "Temporarily Not Available" problem
			// other people say you do. so let's try it.
			trigger: {
			  key: "fired",
			  method: "palm://com.palm.db/watch",		  
			  params: {
				  query: {
					  from: "com.ericblade.synirc.immessage:1",
					  where:
					  [
						  { "prop":"folder", "op":"=", "val":"outbox" },
						  { "prop":"status", "op":"=", "val":"pending" },
						  // TODO: add serviceName and userName here
					  ],
					  limit: 1
				  },
				  subscribe: true
			  },
			}
		}).then(function(f) {
			console.log("sync complete completed", JSON.stringify(f.result));
			f.result = { returnValue: true };
		})
	}	
})
