var app = new Vue({
	el: '#app',
	data: {
		commentTitle: '',
		commentBody: '',
		posts: [],
		comments: [],
		loggedIn: false,
		username: '',
		password: '',
		newPost: [],
		title: '',
		body: '',
		error: false,
		noMore: false
	},
	created() {
		//
	},
	methods: {
		login: async function() {
			await pushP('/login', 'post', { password: this.password, username: this.username }).then((res) => {
				if (res.error) return console.error(res.error);
				this.loggedIn = res;
			})
			await pushP('/posts', 'post', { amount: 100, password: this.password, username: this.username }).then((res) => {
				if (res.error) return console.error(res.error);
				this.posts = res.posts;
				styleR();
			}).catch((err) => { console.error(err) });
		},
		sendPost: function() {
			// { password: string, username: string, title: string, body: string }
			var postToSend = {
				password: this.password,
				username: this.username,
				title: this.title,
				body: this.body
			};
			pushP('/post', 'post', postToSend).then((res) => {
				if (res.error) return console.error(res.error);
				this.posts.push(res.posts[0]);
			})
			this.title = '', this.body = '';
		},
		delPost: async function(postId, show) {
			await pushP('/postDel', 'post', { password: this.password, username: this.username, postId: postId, show: show }).then(async (res) => {
				if (res.error) return console.error(res);
				this.posts.reverse()
				this.posts[postId - 1].show = res.post[0].show;
				this.posts.reverse();
			}).catch((err) => { console.error(err) });
		},
		commentShow: async function(postId) {
			this.comments = [];
			var c = document.getElementsByClassName(`-${postId}`)[0].getElementsByClassName('post-coms')[0];
			let comel = document.querySelectorAll('.post-coms');
			comel.forEach(el => {
				if (c.className === 'post-coms') return;
				el.className = 'post-coms com-hide';
			});
			if (c) {
				if (c.className === 'post-coms') {
					c.className = 'post-coms com-hide';
				} else {
					c.className = 'post-coms';
					await pushP('/comments', 'post', { postId: postId }).then(async (res) => {
						if (res.error) { console.log(res.error); return this.comments = []; };
						// console.log(res);
						res.comments.forEach(com => {
							this.comments.push(com);
						});
						// this.comments = await res.comments;
						styleR();
					});
				};
			};
		}
	}
});

function pushP(url, type, data) {
	return new Promise(function(resolve, reject) {
		if (type === 'post') {
			axios.post(url, data)
				.then(function(res) {
					resolve(res.data)
				})
				.catch(function(error) {
					console.log(error);
					reject(error)
				})
		} else {
			axios.get(url, data)
				.then(function(res) {
					resolve(res.data)
				})
				.catch(function(error) {
					console.log(error);
					reject(error)
				})
		}
	})
}
setTimeout(() => {
	let searchParams = new URLSearchParams(window.location.search);
	var pass = searchParams.get('p')
	var user = searchParams.get('u')
	app.password = pass;
	app.username = user;
	if (searchParams.has('p') && searchParams.has('u')) app.login()
}, 1000)

function styleR() {
	var body = document.querySelector('body');
	body.style.backgroundColor = 'black';
	body.style.color = 'white';
	var textarea = document.querySelectorAll('textarea');
	var input = document.querySelectorAll('input');
	textarea.forEach(item => { item.style.color = 'white'; });
	input.forEach(item => { item.style.color = 'white'; });
	document.querySelectorAll('.com-frame').forEach(i => { i.style.backgroundColor = '#505050' });
	document.querySelectorAll('.post-title').forEach(i => { i.style.color = '#ff7247' });
	document.querySelectorAll('.post-body').forEach(i => { i.style.color = 'white' });
}
styleR()