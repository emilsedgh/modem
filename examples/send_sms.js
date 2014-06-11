/* Usage: node send_sms.js /path/to/device xxxxyyzz "Foo Bar" */

function err(message) {
  console.log('Usage: node send_sms.js /path/to/device xxxxyyzz "Foo Bar"');
  process.exit();
}

var device   = process.argv[2];
var receiver = process.argv[3];
var text     = process.argv[4];

if(!device || !receiver || !text) err();

var modem = require('../index.js').Modem();
modem.open('/dev/ttyUSB0', function() {
  modem.sms({
    receiver:receiver,
    text:text,
    encoding:'7bit'
  }, function(err, sent_ids) {
    console.log('>>', arguments);
    if(err)
      console.log('Error sending sms:', err);
    else
      console.log('Message sent successfully, here are reference ids:', sent_ids.join(','));
  });
});