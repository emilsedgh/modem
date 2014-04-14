/* Usage: node send_sms.js xxxxxxxxx "Foo Bar" */

var modem = require('../index.js').Modem();
modem.open('/dev/ttyUSB0', function() {
  modem.sms({
    receiver:process.argv[2],
    text:process.argv[3],
    encoding:'7bit'
  }, function(err, sent_ids) {
    console.log('>>', arguments);
    if(err)
      console.log('Error sending sms:', err);
    else
      console.log('Message sent successfully, here are reference ids:', sent_ids.join(','));
  });
});