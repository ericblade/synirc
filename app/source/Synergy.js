enyo.kind({
	name: "SynIRC",
	kind: enyo.VFlexBox,
	
    connected: false,
	components: [
		{ name: "subscription", kind: "PalmService", service: "palm://com.ericblade.synirc.service/", method: "subscribeToMe", subscribe: true, onSuccess: "messageReceived", onFailure: "subscribeFailed" },
		{ name: "disconnect", kind: "PalmService", service: "palm://com.ericblade.synirc.service/", method: "disconnect" },
        { name: "CreateSynergyAccount", kind: "PalmService", service: "palm://com.palm.service.accounts/", method: "createAccount", onSuccess: "synergyAccountCreated", onFailure: "synergyAccountFailed" },
		{ name: "RemoveSynergyAccount", kind: "PalmService", service: "palm://com.palm.service.accounts/", method: "deleteAccount", onSuccess: "synergyAccountDeleted", onFailure: "deleteAccountFailed" },
		{ name: "RemoveGroupChats", kind: "PalmService", service: "palm://com.palm.db/", method: "del", onSuccess: "groupChatsCleared", onFailure: "groupChatClearFailed" },
		{ name: "StartActivity", kind: "PalmService", service: "palm://com.ericblade.synirc.service/", method: "startActivity", onSuccess: "activityStarted", onFailure: "activityFailed" },
		{ name: "CancelActivity", kind: "PalmService", service: "palm://com.ericblade.synirc.service/", method: "cancelActivity", onSuccess: "activityCancelled", onFailure: "activityCancelFailed" },
		
		{kind: "PageHeader", components: [
			{content: "SynIRC Internet Relay Chat Control Panel"}
		]},
		{ content: "At the moment, this app must remain running to keep your link to IRC running."},
		{ content: "Enter your server and user information, and press Start." },
		{ content: "You will be able to send and receive IRC messages through the Messaging app." },
		{flex: 1, kind: "Pane", components: [
			{flex: 1, kind: "Scroller", components: [
				{ name: "StartButton", kind: "Button", caption: "Start!", onclick: "startService" },
				{ kind: "RowGroup", caption: "Server", components:
					[
						{ kind: "Item", layoutKind: "HFlexLayout", components:
							[
								{ flex: 1, content: "Server Host (hostname:port)" },
								{ name: "ServerHost", kind: "Input", value: localStorage["server"] || "irc.freenode.net" },
								{ kind: "Spacer" },
							]
						},
					]
				},
				{ kind: "Group", caption: "User", components:
					[
						{ kind: "Item", layoutKind: "HFlexLayout", components:
							[
								{ flex: 1, content: "Nickname (no spaces)" },
								{ name: "Nickname", kind: "Input", value: localStorage["nickname"] || "SynIRCUser" },
								{ kind: "Spacer" },
							]
						},
						{ kind: "Item", layoutKind: "HFlexLayout", components:
							[
								{ flex: 1, content: "Full Name" },
								{ name: "RealName", kind: "Input", value: localStorage["realname"] || "Synergy User" },
								{ kind: "Spacer" },
							]
						},
						{ kind: "Item", layoutKind: "HFlexLayout", components:
							[
								{ flex: 1, content: "User ID (up to 8 chars, no spaces)" },
								{ name: "UserID", kind: "Input", value: localStorage["userid"] || "synirc" },
								{ kind: "Spacer" },
							]
						},
						{ kind: "Item", layoutKind: "HFlexLayout", components:
							[
								{ flex: 1, content: "Start Channel" },
								{ name: "Channel", kind: "Input", value: localStorage["channel"] || "#touchpad,##synirc" },
								{ kind: "Spacer" },
							]
						},
						{ content: "Enter multiple channels by seperating them with a comma, such as: #webos,#touchpad,#webos-ports" }
					]
				},
				{ kind: "Group", caption: "Misc", components:
					[
						{ content: "Sometimes, the Messaging app loses track of the IRC conversations." },
						{ content: "If you join a channel, and nothing happens after several seconds, press this button, and wait a few moments for webOS to try to clear it up." },
						{ kind: "Button", caption: "Clear Group Chats", onclick: "removeGroupChats" },
						{ name: "MessagePopup", kind: "Popup", components:
							[
								{ name: "MessageContent", content: "", lazy: false, },
								{ kind: "Button", content: "OK", onclick: "close", lazy: false },
							]
						}
					]
				},
				{ content: "If you are running webOS, you may want to get the 'Disable Messaging beeps' patch for webOS 3.0.5 in Preware, to cut down on the number of beeps that the Messaging app makes." },
				{ content: "If you are attempting to send a private message to someone, and Messaging warns that they are not logged in, tell it to send the message anyway." },
			]}
		]},
	],
	startService: function() {
		var args = { server: this.$.ServerHost.getValue(), nick: this.$.Nickname.getValue(),
		             realName: this.$.RealName.getValue(), userName: this.$.UserID.getValue(),
					 channels: [ this.$.Channel.getValue() ]
		};
		localStorage["server"] = args.server; localStorage["nickname"] = args.nick;
		localStorage["realname"] = args.realName; localStorage["userid"] = args.userName;
		localStorage["channel"] = args.channels[0];
		if(!this.connected) {
			this.subscription = this.$.subscription.call(args);
			this.$.StartButton.setCaption("Connecting...");
			this.$.StartButton.setDisabled(true);
		} else {
			this.subscription.destroy();
			this.$.disconnect.call({ });
			this.$.StartButton.setCaption("Start!");
			this.connected = false;
		}
	},
	create: function() {
		this.inherited(arguments);
		this.log("existing account = ", localStorage["synergyAccountId"]);
		if(localStorage["synergyAccountId"] === undefined || localStorage["synergyAccountId"] === "undefined")
		{
			this.$.CreateSynergyAccount.call(
				{
					"templateId": "com.ericblade.synirc.account",
					"capabilityProviders": [
											{"id": "com.ericblade.synirc.account.im", "capability":"MESSAGING", "_sync": false }
											],
					"username": "IRC User",
					"alias": "Internet Relay Chat",
					//"credentials": { "common": {"password":"password", "authToken":"authToken"} },
					"password": "password",
					"config": { "ip": "8.8.8.8" }
				});
		}
		//this.$.RemoveGroupChats.call({ query: { from: "com.ericblade.synirc.imgroupchat:1" }});
	},
	removeGroupChats: function(inSender, inEvent) {
		this.$.RemoveGroupChats.call({ query: { from: "com.ericblade.synirc.imgroupchat:1" }});
	},
	messageReceived: function(inSender, inResponse, inRequest)
	{
		this.log("inResponse=", inResponse);
		if(inResponse.registered === true)
		{
			this.$.StartButton.setCaption("Disconnect");
			this.$.StartButton.setDisabled(false);
			this.connected = true;
			this.$.StartActivity.call({});
		}
	},
	subscribeFailed: function(inSender, inError, inRequest)
	{
		this.log("inError=", inError);
		if(this.subscription && this.subscription.destroy)
			this.subscription.destroy();
		this.$.disconnect.call({ });
		this.$.StartButton.setCaption("Start!");
		this.connected = false;
		this.$.CancelActivity.call({ });
		this.startService();
	},
	synergyAccountCreated: function(inSender, inResponse, inRequest)
	{
		this.log("inResponse=", inResponse);
		localStorage["synergyAccountId"] = inResponse.result["_id"];
	},
	synergyAccountFailed: function(inSender, inError, inRequest)
	{
		this.log("inError=", inError);
	},
	synergyAccountDeleted: function(inSender, inResponse, inRequest)
	{
		this.log("inResponse=", inResponse);
		localStorage["synergyAccountId"] = undefined;
	},
	deleteAccountFailed: function(inSender, inError, inRequest)
	{
		this.log("inError=", inError);
		localStorage["synergyAccountId"] = undefined;
	},
    groupChatsCleared: function(inSender, inResponse, inRequest) {
		this.$.MessageContent.setContent("IRC Chats reset, please wait a few moments for chatthreader to re-thread the conversations");
		this.$.MessagePopup.openAtCenter();
		this.log("inResponse=", inResponse);
	},
	groupChatClearFailed: function(inSender, inError, inRequest) {
		this.$.MessageContent.setContent("Something went wrong with our request to reset the chats.");
		this.$.MessagePopup.openAtCenter();
		this.log("inError=", inError);
	},
    activityStarted: function(inSender, inResponse, inRequest) {
	    this.log("inResponse=", inResponse);
	},
	activityFailed: function(inSender, inError, inRequest) {
		this.log("inError=", inError);
	},
	activityCancelled: function(inSender, inResponse, inRequest) {
		this.log("inResponse=", inResponse);
	},
	activityCancelFailed: function(inSender, inError, inRequest) {
		this.log("inError=", inError);
	}
});
