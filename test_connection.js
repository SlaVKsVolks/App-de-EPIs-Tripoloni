const https = require('https');

const url = 'https://script.google.com/macros/s/AKfycbw8utTRVq8sStYKG0wcAejjfsEMZfCbAe1VZS0CeE0xnmxpUWl7HJPyXzrJBKdO3piL/exec?action=getData';

https.get(url, (res) => {
    let data = '';

    // A chunk of data has been received.
    res.on('data', (chunk) => {
        data += chunk;
    });

    // The whole response has been received. Print out the result.
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        if (res.statusCode === 302) {
            console.log('Redirect Location:', res.headers.location);
            // Follow redirect
            https.get(res.headers.location, (res2) => {
                let data2 = '';
                res2.on('data', (chunk) => data2 += chunk);
                res2.on('end', () => console.log('Redirected Response:', data2));
            });
        } else {
            console.log('Response:', data);
        }
    });

}).on("error", (err) => {
    console.log("Error: " + err.message);
});
