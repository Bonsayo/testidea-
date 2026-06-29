var https = require('https');
var url = 'https://mel-bet.et/en/live/basketball/2935701-nba-2k26-cyber-league';
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
  var d = '';
  res.on('data', function(c) { d += c; });
  res.on('end', function() {
    var re = /Get(?:1x2_VZip|SportsShortZip|TopGamesStatZip)[^"'<>\s]*/g;
    var apis = [];
    var m;
    while ((m = re.exec(d)) !== null) apis.push(m[0]);
    if (apis.length > 0) {
      console.log('Found ' + apis.length + ' API refs:');
      apis.forEach(function(a) { console.log('  ' + a); });
    } else {
      console.log('No basketball API refs found in HTML');
    }
    // Check if page loads via script with a different URL pattern
    var scriptRe = /<script[^>]*src=["']([^"']*)["'][^>]*>/g;
    var scripts = [];
    while ((m = scriptRe.exec(d)) !== null) scripts.push(m[1]);
    var apiScripts = scripts.filter(function(s) { return s.indexOf('web-api') >= 0 || s.indexOf('api') >= 0; });
    if (apiScripts.length > 0) {
      console.log('API-related scripts:');
      apiScripts.forEach(function(s) { console.log('  ' + s); });
    }
    var iframes = d.match(/<iframe[^>]*src=["']([^"']*api[^"']*)["']/g);
    if (iframes) console.log('Iframe APIs:', iframes.length);
  });
}).on('error', function(e) { console.log('Error:', e.message); });
setTimeout(function() { process.exit(0); }, 10000);
