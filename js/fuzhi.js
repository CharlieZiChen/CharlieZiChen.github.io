/** 监听copy事件 */
document.addEventListener("copy",function(e){
    //复制的内容
    btf.snackbarShow('吾宣布，汝的剪贴板已经被吾占领啦！', false, 3000)
})
// 检测按键
window.onkeydown = function (e) {
    if (e.keyCode === 123) {
      btf.snackbarShow('谢绝了汝观看源码之意愿，吾抱歉万分', false, 3000)
    }
  }