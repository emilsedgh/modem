Modem.js, GSM Modems on Node
============================
> Modem.js allows you to use your GSM modems on node.
It offers a very simple API.
It supports:
* Sending SMS messages
* Receiving SMS messages
* Getting delivery reports
* Deleting messages from memory
* Getting notifications when memory is full
* Getting signal quality
* Making ussd sessions
* 16bit (ucsd messages)
* 7bit (ascii) messages
* Multipart messages
* Getting notifications when someone calls

Installation
------------
```
npm install modem
```

Instantiate
-----------
```
var modem = require('modem').Modem()
```

Open modem
----------
```
modem.open(device, callback)
```

* device `String` Path to device, like `/dev/ttyUSB0`
   * callback `Function` called when modem is ready for further action

Send a message
--------------
```
modem.sms(message, callback)
```

* message `Object`
    * text `String` message body. Longs messages will be splitted and
        sent in multiple parts transparently.
    * receiver `String` receiver number.
    * encoding `String`. '16bit' or '7bit'. Use 7bit in case of English messages.

callback `Fucntion`(err, references) is called when sending is done.
  * references `Array` contains reference ids for each part of sent message. (A message may take up to several parts)


Get delivery reports
--------------------
```
modem.on('delivery', callback)
```

* callback `Function` is called with the following arguments:

* details `Object` detailed status report
    * smsc `String` Msisdn of SMS Sender
    * reference `String` Reference number of the delivered message
    * sender  `Msisdn of receiver`
    * status `Delivery status`

* index `String` index of this delivery report in storage

Receive a message
-----------------
```
modem.on('sms received', callback)
```

* callback `Function` will be called on each new message with following arguments:
* message `Object`
    * smsc `String` MSISDN of SMS Center
    * sender `String` MSISDN of sender
    * time `Date` Send time
    * text  `String` message body

Get stored messages
-------------------
```
modem.getMessages(callback)
```
* callback `Function` will be called with a single argument
  messages `Array`, which contains stores messages

Delete a message
----------------
```
modem.deleteMessage(message_index, callback)
```

* message_index `Int` is the message index to be deleted
* callback `Function` called when message is deleted

Get notified when memory is full
--------------------------------
```
modem.on('memory full', callback)
```
* callback `Function` will be called when modem has no more space
for further messages

Get notified when someone calls
--------------------------------
```
modem.on('ring', callback)
```
* callback `Function` will be called on each RING with a single argument
* msisdn `Number`

Running custom AT commands
==========================
> Modem.js allows you to run AT commands in a queue and manage them without messing the modem.
API is still quite simple.

Run a command
-------------
```
job = modem.execute(at_command, [callback], [priority], [timeout])
```

* at_command `String` AT command you would like to execute
* callback `Function` called when execution is done, in form of `(escape_char, [response])`
    * escape_char `String` could be 'OK', 'ERROR' or '>'.
    * response `String` modem's response
* prior `Boolean` if set to true, command will be executed immediately
* timeout `Integer` timeout, in milliseconds, defaults to 60 seconds.
* job `EventEmitter` represents the added job.
    * it will emit `timeout` if executing job times out

USS Sessions
============
> Modem.js allows you ro tun ussd sessions.

Instantiate
-----------
```
var Session = require('modem').Ussd_Session
```

Create a session
----------------
```
var Session = require('modem').Ussd_Session
var CheckBalance = function(c) {
    var session = new Session;
    session.callback = c;

    session.parseResponse = function(response_code, message) {
        this.close();

        var match = message.match(/([0-9,\,]+)\sRial/);
        if(!match) {
            if(this.callback)
                this.callback(false);
            return ;
        }


        if(this.callback)
            this.callback(match[1]);

        session.modem.credit = match[1];
    }

    session.execute = function() {
        this.query('*141*#', session.parseResponse);
    }

    return session;
}
```
