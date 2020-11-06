const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const cors = require('cors');
const PORT = process.env.PORT || 3000;
const superagent = require('superagent');

/* === Data stuff === */
const _ = require('lodash');
const fs = require('fs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const adapter = new FileSync('data/posts.json');
const db = low(adapter);
db.defaults({ posts: [], comments: [] }).write();

const showdown = require('showdown');
const converter = new showdown.Converter({
	underline: true,
	noHeaderId: true,
	simplifiedAutoLink: true,
	strikethrough: true,
	tasklists: true,
	simpleLineBreaks: true,
	openLinksInNewWindow: true,
	backslashEscapesHTMLTags: true,
	emoji: true,
});
const Turndown = require('turndown');
const turndown = new Turndown;
const sanitizeHtml = require('sanitize-html');

async function mdToHtml(data) {
	let d = [];
	if (data === undefined) {
		console.log('Error in mdToHtml');
		return [{ title: 'error', body: 'ERROR' }];
	}
	await data.forEach((item) => {
		if (item.body === undefined && item.title !== undefined) return d.push(item)
		item.body = converter.makeHtml(item.body).replace('<p>', '').replace('</p>', '');
		d.push(item);
	})
	return d;
}

const PASSWORD = process.env.PASSWORD, USERNAME = process.env.USERNAME;


app.use(cors({
	origin: ['https://insberr.github.io'],
	methods: ['GET', 'POST']
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


/* ===== Requests ===== */
app.use(express.static('public'));
app.get('/ping', async (req, res) => { return res.send('OK') });
app.post('/login', async (req, res) => {
	let d = req.body;
	if (!checkPass(d.password, d.username)) return res.send({ error: 'Incorrect pass or user' });
	return res.send(true);
});

/* === Get Posts === */
app.post('/posts', async (req, res) => {
	if (req.body === undefined) return;
	if (req.body.get) {
		return res.send(await postsF('get', { id: req.body.get }));
	} else {
		return res.send(await postsF('get', {
			have: req.body.have,
			amount: req.body.amount
		}));
	};
});

/* === Get Comments === */
app.post('/comments', async (req, res) => {
	if (req.body === undefined) return;
	return res.send({ comments: await commentsF('get', { postId: req.body.postId }) });
});

/* === Create A Post === */
app.post('/post', async (req, res) => {
	if (req.body === undefined) return;
	return res.send(await postsF('create', {
		username: req.body.username,
		title: req.body.title,
		body: req.body.body,
		pass: req.body.password
	}));
});

/* === Create A Comment === */
app.post('/comment', async (req, res) => {
	let d = req.body;
	if (!d || !d.postId || !d.username || !d.body) return res.send({ error: 'Missing arguments' });
	if (d.username.toLowerCase().includes('spider')) return res.send({ error: 'You cannot use spider in your username' });
	if (d.title.length > 20) return res.send({ error: 'The title is longer than the 20 character limit' });
	if (d.body.length > 150) return res.send({ error: 'The body is longer than the 150 character limit'});
	let comment = await commentsF('create', {
		postId: d.postId,
		username: d.username,
		title: d.title || '',
		body: d.body || '',
	})

	let posts = await postsF('inc', { id: d.postId });
	let comments = await commentsF('get', { postId: d.postId });
	return res.send({ comments: comments, posts: posts.posts });
});

/* === Hide/Unhide A Post === */
app.post('/hide', async (req, res) => {
	return res.send({ error: 'No functionallity' });
});

app.post('/suggest', async (req, res) => {
	let d = req.body;
	if (!d || !d.s || !d.username) return res.send({ error: 'Missing arguments' });

	superagent.post(`https://api.trello.com/1/cards?key=${process.env.KEY}&token=${process.env.TOKEN}&idList=${process.env.LIST}&name=${d.username + ': ' + d.s}&idLabels=5f28ee227669b22549c87d6c`)
		.end((err, res) => {
			if (err) return;
		});
	rss({ s: d.s, u: d.username }, 'suggestion');
	return res.send({ info: `Your suggestion '${d.s}' was sucessfully sent.` });
});


/* ===== Functions ===== */
async function postsF(act, opt) {
	switch (act) {
		case 'get': {
			if (opt.id > 0) {
				let post = await db.get('posts')
					.find({ id: parseInt(opt.id), show: true })
					.cloneDeep()
					.value()
				// console.log({ post: post, id: opt.id })
				if (post === undefined) return [{ title: `A post by the id '${opt.id}' does not exist or has been deleted` }];
				return { posts: await mdToHtml([post]).then((value) => value) };
			} else {
				let posts = await db.get('posts')
					.orderBy(['id'], ['desc'])
					.drop(opt.have || 0)
					.filter(opt.filter || { show: true })
					.take(opt.amount || 5)
					.cloneDeep()
					.value();

				if (posts.length === 0) return [{ title: 'No posts exist' }];
				return { posts: await mdToHtml(posts).then((value) => value) };
			}
		}
		case 'create': {
			if (!checkPass(opt.pass, opt.username)) return { error: 'Invalid login' };
			let postId = await _.last(db.get('posts').value()).id + 1;
			await db.get('posts')
				.push({
					id: postId,
					title: sanitizeHtml(opt.title),
					body: sanitizeHtml(opt.body),
					comment: 0,
					show: true,
					create: date()
				})
				.write()
			let post = await db.get('posts')
				.find({ id: postId })
				.cloneDeep()
				.value();
			if (post.length === 0) return { error: 'Failed to create a post' };
			rss([post], 'post')
			return { posts: await mdToHtml([post]).then((value) => value) };
		}
		case 'inc': {
			// if (checkPass(options.login.p, options.login.u) !== true) return { error: 'Failed to create post: Invalid login' };
			await db.get('posts')
				.find({ id: opt.id })
				.update('comment', n => n + 1)
				.write()
			let post = await db.get('posts')
				.find({ id: opt.id })
				.cloneDeep()
				.value();
			return await mdToHtml([post]).then((value) => value);
		}
		default: {
			return { error: 'No action specified' };
		}
	}
}

async function commentsF(action, options) {
	switch (action) {
		case 'get': {
			let comments = await db.get('comments')
				.orderBy(['id'], ['asc'])
				.filter({ postId: options.postId })
				.cloneDeep()
				.value();
			if (comments.length === 0) return [{ title: 'No comments' }];
			return await mdToHtml(comments).then((value) => value);
		}
		case 'create': {
			let commentId = await _.last(db.get('comments').value()).id + 1;
			await db.get('comments')
				.push({
					id: commentId,
					postId: options.postId,
					title: sanitizeHtml(options.title),
					body: sanitizeHtml(options.body),
					username: options.username,
					create: date()
				})
				.write()
			let comment = await db.get('comments')
				.find({ id: commentId })
				.cloneDeep()
				.value();
			if (comment.length === 0) return { error: 'Failed to create a comment' };
			rss([comment], 'comment');
			return await mdToHtml([comment]).then((value) => value);
		}
		default: {
			return { error: 'No action was provided' };
		}
	}
}

async function checkPass(p, u) {
	if (p !== PASSWORD || u !== USERNAME) return false;
	return true;
}

function date(date) {
	let d = new Date();
	let utc = d.getTime() + (d.getTimezoneOffset() * 60000);
	let nd = new Date(utc + (3600000 * -7));
	let dateDone = nd.toLocaleDateString('en-US', { weekday: 'long' }).slice(0, 3);
	dateDone += ' ' + nd.toLocaleString().slice(0, 10).replace(',', '');
	dateDone += ' ' + nd.toLocaleString().slice(10, 22);
	return dateDone;
}

async function rss(data, type) {
	if (type === 'suggestion') {
		superagent
			.post(process.env.WEBHOOKS)
			.send({
				embeds: [
					{
						title: `${data.u} Created a Suggestion`,
						description: data.s,
						url: `https://trello.com/b/BKwdwxpC/website`,
						footer: {
							text: `${data.u || 'Unknown'} ${type}ed`
						},
						timestamp: new Date(),
						color: 16776960
					}
				]
			})
			.set('accept', 'json')
			.end((err, res) => {
				if (err) return;
				return;
			});
		return;
	}
	superagent
		.post(process.env.WEBHOOKS)
		.send({
			embeds: [
				{
					title: data[0].title || 'No Title',
					description: data[0].body || 'No Body',
					url: `https://spidergamin.github.io?l=posts-${data[0].postId || data[0].id}`,
					footer: {
						text: `${data[0].username || 'SpiderGaming'} ${type}ed`
					},
					color: 16711680
				}
			]
		})
		.set('accept', 'json')
		.end((err, res) => {
			if (err) return;
			return;
		});
	return;
}


/* JSON file send */
app.get('/links.json', function(req, res) {
	fs.readFile('data/links.json', (err, file) => {
		if (err) return res.send({ error: 'Failed to load json file' });
		return res.send(file);
	});
});

app.get('/lists.json', (req, res) => {
	fs.readFile('data/lists.json', (err, file) => {
		if (err) return res.send({ error: 'Failed to load json file' });
		return res.send(file);
	});
});


const server = app.listen(PORT, function() {
	console.log("Server started on port %s", server.address().port);
});